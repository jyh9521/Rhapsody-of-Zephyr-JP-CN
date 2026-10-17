/*
 * ZPGDI.dll - import-table proxy for the game's GDI32.dll imports.
 *
 * Build as a 32-bit DLL. The game imports GDI32.dll by name; zephyr.exe is
 * patched to import ZPGDI.dll instead. This proxy forwards all imported GDI
 * functions to the real system GDI32.dll, while intercepting CreateFontA and
 * TextOutA for Chinese text rendering.
 *
 * v2 additions:
 *   - Vectored exception handler: fatal exceptions (access violation etc.)
 *     are appended to zpgdi.log with address/registers before the process
 *     dies, so crashes can be located offline.
 *   - Sequence-level speaker-name mapping: instead of a hardcoded per-glyph
 *     remap, consecutive Shift-JIS glyph draws are matched against name
 *     sequences.
 * v3 addition:
 *   - Name mapping waits for a full-name match before emitting glyphs, which
 *     avoids mixing prefixes from unrelated names.
 * v4 note:
 *   - External zpgdi_names.tsv is no longer part of the active workflow, so the
 *     DLL no longer loads it at startup.
 * v5 note:
 *   - Speaker-name sequences are built into the DLL from
 *     _work/text/speaker_names_to_translate.tsv at build time.
 * v7 note:
 *   - The v6 per-glyph speaker-name mapper is disabled.  The game caches
 *     glyphs without enough text context, so mapping one Shift-JIS glyph to one
 *     Chinese glyph corrupts every unrelated use of the same glyph.
 *   - Untranslated low-range Shift-JIS glyphs are rendered through CP932 as a
 *     diagnostic fallback instead of CP936 mojibake.
 */

#define WIN32_LEAN_AND_MEAN
#define NOGDI
#include <windows.h>
#include <stdio.h>
#include <stdint.h>
#include <string.h>

#ifndef GB2312_CHARSET
#define GB2312_CHARSET 134
#endif

typedef HANDLE (WINAPI *PFN_CreateCompatibleDC)(HANDLE);
typedef HANDLE (WINAPI *PFN_CreateDCA)(LPCSTR, LPCSTR, LPCSTR, const void *);
typedef HANDLE (WINAPI *PFN_CreateDIBSection)(HANDLE, const void *, UINT, void **, HANDLE, DWORD);
typedef HANDLE (WINAPI *PFN_CreateFontA)(int, int, int, int, int, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, LPCSTR);
typedef HANDLE (WINAPI *PFN_CreatePalette)(const void *);
typedef BOOL (WINAPI *PFN_DeleteDC)(HANDLE);
typedef BOOL (WINAPI *PFN_DeleteObject)(HANDLE);
typedef int (WINAPI *PFN_GetObjectA)(HANDLE, int, LPVOID);
typedef HANDLE (WINAPI *PFN_SelectObject)(HANDLE, HANDLE);
typedef HANDLE (WINAPI *PFN_SelectPalette)(HANDLE, HANDLE, BOOL);
typedef int (WINAPI *PFN_SetBkMode)(HANDLE, int);
typedef DWORD (WINAPI *PFN_SetTextColor)(HANDLE, DWORD);
typedef int (WINAPI *PFN_StretchDIBits)(HANDLE, int, int, int, int, int, int, int, int, const void *, const void *, UINT, DWORD);
typedef BOOL (WINAPI *PFN_TextOutA)(HANDLE, int, int, LPCSTR, int);
typedef BOOL (WINAPI *PFN_TextOutW)(HANDLE, int, int, LPCWSTR, int);
typedef int (WINAPI *PFN_AddFontResourceExA)(LPCSTR, DWORD, PVOID);
typedef DWORD (WINAPI *PFN_GetTextColor)(HANDLE);

static HMODULE g_gdi32;
static HANDLE g_log = INVALID_HANDLE_VALUE;
static LONG g_text_log_count;
static LONG g_crash_log_count;
static char g_dir[MAX_PATH];

static PFN_CreateCompatibleDC real_CreateCompatibleDC;
static PFN_CreateDCA real_CreateDCA;
static PFN_CreateDIBSection real_CreateDIBSection;
static PFN_CreateFontA real_CreateFontA;
static PFN_CreatePalette real_CreatePalette;
static PFN_DeleteDC real_DeleteDC;
static PFN_DeleteObject real_DeleteObject;
static PFN_GetObjectA real_GetObjectA;
static PFN_SelectObject real_SelectObject;
static PFN_SelectPalette real_SelectPalette;
static PFN_SetBkMode real_SetBkMode;
static PFN_SetTextColor real_SetTextColor;
static PFN_StretchDIBits real_StretchDIBits;
static PFN_TextOutA real_TextOutA;
static PFN_TextOutW real_TextOutW;
static PFN_AddFontResourceExA real_AddFontResourceExA;
static PFN_GetTextColor real_GetTextColor;
static DWORD g_last_color = 0xFFFFFFFF;

/* ------------------------------------------------------------------ */
/* Logging helpers                                                     */
/* ------------------------------------------------------------------ */

static void append_path(char *dst, const char *name) {
    size_t len = strlen(dst);
    if (len && dst[len - 1] != '\\' && len + 1 < MAX_PATH) {
        dst[len++] = '\\';
        dst[len] = '\0';
    }
    strncat(dst, name, MAX_PATH - strlen(dst) - 1);
}

static void init_dir(HMODULE self) {
    DWORD n;
    char *slash;

    if (g_dir[0]) {
        return;
    }

    n = GetModuleFileNameA(self, g_dir, sizeof(g_dir));
    if (!n || n >= sizeof(g_dir)) {
        lstrcpyA(g_dir, ".");
        return;
    }

    slash = strrchr(g_dir, '\\');
    if (slash) {
        *slash = '\0';
    } else {
        lstrcpyA(g_dir, ".");
    }
}

static void ensure_log(void) {
    char path[MAX_PATH];

    if (g_log != INVALID_HANDLE_VALUE) {
        return;
    }

    lstrcpynA(path, g_dir[0] ? g_dir : ".", sizeof(path));
    append_path(path, "zpgdi.log");
    g_log = CreateFileA(path, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE,
                        NULL, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
}

static void log_line(const char *line) {
    DWORD written;

    ensure_log();
    if (g_log == INVALID_HANDLE_VALUE) {
        return;
    }
    WriteFile(g_log, line, (DWORD)strlen(line), &written, NULL);
    FlushFileBuffers(g_log);
}

/* ------------------------------------------------------------------ */
/* Crash logger                                                        */
/* ------------------------------------------------------------------ */

static int is_fatal_code(DWORD code) {
    switch (code) {
    case 0xC0000005: /* EXCEPTION_ACCESS_VIOLATION */
    case 0xC000001D: /* EXCEPTION_ILLEGAL_INSTRUCTION */
    case 0xC0000094: /* EXCEPTION_INT_DIVIDE_BY_ZERO */
    case 0xC0000096: /* EXCEPTION_PRIV_INSTRUCTION */
    case 0xC00000FD: /* EXCEPTION_STACK_OVERFLOW */
    case 0xC000008C: /* EXCEPTION_ARRAY_BOUNDS_EXCEEDED */
        return 1;
    default:
        return 0;
    }
}

static void module_of(void *addr, char *name, size_t name_size, uintptr_t *base) {
    MEMORY_BASIC_INFORMATION mbi;

    *base = 0;
    name[0] = '\0';
    if (VirtualQuery(addr, &mbi, sizeof(mbi)) && mbi.AllocationBase) {
        char full[MAX_PATH] = "";
        const char *slash;
        *base = (uintptr_t)mbi.AllocationBase;
        if (GetModuleFileNameA((HMODULE)mbi.AllocationBase, full, sizeof(full))) {
            slash = strrchr(full, '\\');
            lstrcpynA(name, slash ? slash + 1 : full, (int)name_size);
        }
    }
}

static LONG CALLBACK crash_handler(PEXCEPTION_POINTERS ep) {
    char line[512];
    char mod[64];
    uintptr_t base = 0;
    DWORD code;
    void *addr;
    CONTEXT *c;
    SIZE_T got;
    DWORD stack[16];
    int i;

    if (!ep || !ep->ExceptionRecord) {
        return EXCEPTION_CONTINUE_SEARCH;
    }

    code = ep->ExceptionRecord->ExceptionCode;
    if (!is_fatal_code(code)) {
        return EXCEPTION_CONTINUE_SEARCH;
    }
    if (InterlockedIncrement(&g_crash_log_count) > 8) {
        return EXCEPTION_CONTINUE_SEARCH;
    }

    addr = ep->ExceptionRecord->ExceptionAddress;
    module_of(addr, mod, sizeof(mod), &base);

    snprintf(line, sizeof(line),
             "CRASH code=%08lX addr=%p module=%s base=%08lX rva=%08lX tick=%lu\r\n",
             code, addr, mod[0] ? mod : "?", (unsigned long)base,
             (unsigned long)((uintptr_t)addr - base), GetTickCount());
    log_line(line);

    if (code == 0xC0000005 && ep->ExceptionRecord->NumberParameters >= 2) {
        snprintf(line, sizeof(line),
                 "CRASH av type=%lu (0=read 1=write 8=exec) target=%08lX\r\n",
                 (unsigned long)ep->ExceptionRecord->ExceptionInformation[0],
                 (unsigned long)ep->ExceptionRecord->ExceptionInformation[1]);
        log_line(line);
    }

    c = ep->ContextRecord;
    if (c) {
        snprintf(line, sizeof(line),
                 "CRASH eip=%08lX esp=%08lX ebp=%08lX eax=%08lX ebx=%08lX ecx=%08lX edx=%08lX esi=%08lX edi=%08lX\r\n",
                 c->Eip, c->Esp, c->Ebp, c->Eax, c->Ebx, c->Ecx, c->Edx, c->Esi, c->Edi);
        log_line(line);

        got = 0;
        if (ReadProcessMemory(GetCurrentProcess(), (const void *)(uintptr_t)c->Esp,
                              stack, sizeof(stack), &got) && got >= sizeof(DWORD)) {
            char *p = line;
            p += snprintf(p, sizeof(line) - (p - line), "CRASH stack");
            for (i = 0; i < (int)(got / sizeof(DWORD)) && i < 16; i++) {
                uintptr_t sb = 0;
                char smod[64];
                module_of((void *)(uintptr_t)stack[i], smod, sizeof(smod), &sb);
                if (smod[0]) {
                    p += snprintf(p, sizeof(line) - (p - line), " %08lX(%s+%lX)",
                                  (unsigned long)stack[i], smod,
                                  (unsigned long)(stack[i] - sb));
                } else {
                    p += snprintf(p, sizeof(line) - (p - line), " %08lX",
                                  (unsigned long)stack[i]);
                }
                if ((size_t)(p - line) > sizeof(line) - 96) break;
            }
            snprintf(p, sizeof(line) - (p - line), "\r\n");
            log_line(line);
        }
    }

    return EXCEPTION_CONTINUE_SEARCH;
}

/* ------------------------------------------------------------------ */
/* Speaker-name sequence mapping                                       */
/* ------------------------------------------------------------------ */

#define MAX_NAMES 320
#define MAX_NAME_GLYPHS 16

typedef struct {
    unsigned char sjis[MAX_NAME_GLYPHS * 2];
    int glyphs;               /* number of 2-byte Shift-JIS glyphs */
    WCHAR cn[MAX_NAME_GLYPHS];
    int cnlen;                /* number of UTF-16 code units */
} NameEntry;

typedef struct {
    unsigned char sjis[2];
    WCHAR cn;
} GlyphEntry;

#include "zpgdi_builtin_names.h"

static NameEntry g_names[MAX_NAMES];
static int g_name_count;

static const NameEntry ZPGDI_MAP_NAMES[] = {
    { {0x83, 0x54, 0x83, 0x43, 0x83, 0x89, 0x83, 0x62, 0x83, 0x76, 0x83, 0x58}, 6, {0x8D5B, 0x62C9, 0x666E, 0x65AF}, 4 }, /* サイラップス -> 赛拉普斯 */
    { {0x83, 0x4A, 0x83, 0x89, 0x83, 0x4A, 0x83, 0x58, 0x82, 0xCC, 0x90, 0x58}, 6, {0x5361, 0x62C9, 0x5361, 0x65AF, 0x68EE, 0x6797}, 6 }, /* カラカスの森 -> 卡拉卡斯森林 */
    { {0x83, 0x4A, 0x83, 0x89, 0x83, 0x4A, 0x83, 0x58, 0x91, 0xBA}, 5, {0x5361, 0x62C9, 0x5361, 0x65AF, 0x6751}, 5 }, /* カラカス村 -> 卡拉卡斯村 */
    { {0x83, 0x76, 0x83, 0x8A, 0x83, 0x67, 0x83, 0x8A, 0x83, 0x41, 0x8E, 0x52}, 6, {0x666E, 0x91CC, 0x6258, 0x5229, 0x4E9A, 0x5C71}, 6 }, /* プリトリア山 -> 普里托利亚山 */
    { {0x83, 0x76, 0x83, 0x8A, 0x83, 0x67, 0x83, 0x8A, 0x83, 0x41, 0x91, 0xBA}, 6, {0x666E, 0x91CC, 0x6258, 0x5229, 0x4E9A, 0x6751}, 6 }, /* プリトリア村 -> 普里托利亚村 */
    { {0x95, 0x73, 0x8E, 0x80, 0x92, 0xB9, 0x82, 0xCC, 0x93, 0xB4, 0x8C, 0x41}, 6, {0x4E0D, 0x6B7B, 0x9E1F, 0x6D1E, 0x7A9F}, 5 }, /* 不死鳥の洞窟 -> 不死鸟洞窟 */
    { {0x83, 0x51, 0x83, 0x43, 0x83, 0x56, 0x83, 0x8B, 0x92, 0xAC}, 5, {0x51EF, 0x897F, 0x5C14, 0x9547}, 4 }, /* ゲイシル町 -> 凯西尔镇 */
    { {0x83, 0x51, 0x83, 0x43, 0x83, 0x56, 0x83, 0x8B, 0x82, 0xCC, 0x90, 0x58}, 6, {0x51EF, 0x897F, 0x5C14, 0x68EE, 0x6797}, 5 }, /* ゲイシルの森 -> 凯西尔森林 */
    { {0x83, 0x6A, 0x83, 0x52, 0x83, 0x56, 0x83, 0x41}, 4, {0x5C3C, 0x79D1, 0x897F, 0x4E9A}, 4 }, /* ニコシア -> 尼科西亚 */
    { {0x83, 0x81, 0x83, 0x93, 0x83, 0x74, 0x83, 0x42, 0x83, 0x58}, 5, {0x5B5F, 0x83F2, 0x65AF}, 3 }, /* メンフィス -> 孟菲斯 */
    { {0x89, 0xCE, 0x97, 0xB3, 0x8C, 0x41}, 3, {0x706B, 0x9F99, 0x7A9F}, 3 }, /* 火竜窟 -> 火龙窟 */
    { {0x83, 0x8D, 0x81, 0x5B, 0x83, 0x47, 0x83, 0x93, 0x8E, 0x52}, 5, {0x7F57, 0x6069, 0x5C71}, 3 }, /* ローエン山 -> 罗恩山 */
    { {0x97, 0xAC, 0x90, 0xAF, 0x8C, 0x95, 0x82, 0xCC, 0x93, 0xB4, 0x8C, 0x41}, 6, {0x6D41, 0x661F, 0x5251, 0x6D1E, 0x7A9F}, 5 }, /* 流星剣の洞窟 -> 流星剑洞窟 */
    { {0x96, 0x82, 0x8C, 0x95, 0x82, 0xCC, 0x90, 0x58}, 4, {0x9B54, 0x5251, 0x4E4B, 0x68EE}, 4 }, /* 魔剣の森 -> 魔剑之森 */
    { {0x83, 0x7B, 0x83, 0x8B, 0x83, 0x68, 0x81, 0x5B}, 4, {0x6CE2, 0x5C14, 0x591A}, 3 }, /* ボルドー -> 波尔多 */
    { {0x83, 0x68, 0x83, 0x89, 0x83, 0x53, 0x83, 0x93, 0x83, 0x75, 0x83, 0x8C, 0x83, 0x58, 0x8E, 0x52, 0x96, 0xAC}, 9, {0x9F99, 0x606F, 0x5C71, 0x8109}, 4 }, /* ドラゴンブレス山脈 -> 龙息山脉 */
    { {0x83, 0x5B, 0x83, 0x74, 0x83, 0x42, 0x81, 0x5B, 0x83, 0x8B, 0x96, 0x7B, 0x95, 0x94}, 7, {0x897F, 0x98CE, 0x730E, 0x9E70, 0x672C, 0x90E8}, 6 }, /* ゼフィール本部 -> 西风猎鹰本部 */
    { {0x8A, 0x43, 0x91, 0xAF, 0x82, 0xCC, 0x93, 0xB4, 0x8C, 0x41}, 5, {0x6D77, 0x76D7, 0x6D1E, 0x7A9F}, 4 }, /* 海賊の洞窟 -> 海盗洞窟 */
    { {0x83, 0x8A, 0x83, 0x75, 0x83, 0x8C, 0x83, 0x72, 0x83, 0x8B}, 5, {0x5229, 0x5E03, 0x52D2, 0x7EF4, 0x5C14}, 5 }, /* リブレビル -> 利布勒维尔 */
    { {0x83, 0x72, 0x83, 0x74, 0x83, 0x8D, 0x83, 0x58, 0x83, 0x67, 0x8D, 0x91, 0x8B, 0xAB}, 7, {0x6BD4, 0x5F17, 0x7F57, 0x65AF, 0x7279, 0x56FD, 0x5883}, 7 }, /* ビフロスト国境 -> 比弗罗斯特国境 */
    { {0x83, 0x41, 0x83, 0x93, 0x83, 0x5E, 0x83, 0x69, 0x83, 0x69, 0x83, 0x8A, 0x83, 0x7B, 0x8E, 0x52, 0x92, 0x6E}, 9, {0x5B89, 0x5854, 0x90A3, 0x90A3, 0x5229, 0x5821, 0x5C71, 0x5730}, 8 }, /* アンタナナリボ山地 -> 安塔那那利堡山地 */
    { {0x83, 0x41, 0x83, 0x93, 0x83, 0x5E, 0x83, 0x69, 0x83, 0x69, 0x83, 0x8A, 0x83, 0x7B, 0x97, 0x76, 0x8D, 0xC7}, 9, {0x5B89, 0x5854, 0x90A3, 0x90A3, 0x5229, 0x5821, 0x8981, 0x585E}, 8 }, /* アンタナナリボ要塞 -> 安塔那那利堡要塞 */
    { {0x88, 0xEA, 0x8A, 0x70, 0x8F, 0x62, 0x82, 0xCC, 0x93, 0xB4, 0x8C, 0x41}, 6, {0x72EC, 0x89D2, 0x517D, 0x6D1E, 0x7A9F}, 5 }, /* 一角獣の洞窟 -> 独角兽洞窟 */
    { {0x83, 0x7D, 0x83, 0x93, 0x83, 0x65, 0x83, 0x42, 0x83, 0x52, 0x83, 0x41, 0x8E, 0x52}, 7, {0x66FC, 0x8482, 0x67EF, 0x5C14, 0x5C71}, 5 }, /* マンティコア山 -> 曼蒂柯尔山 */
    { {0x83, 0x67, 0x83, 0x44, 0x83, 0x8A, 0x83, 0x56, 0x83, 0x58, 0x8D, 0xBB, 0x94, 0x99}, 7, {0x56FE, 0x91CC, 0x897F, 0x65AF, 0x6C99, 0x6F20}, 6 }, /* トゥリシス砂漠 -> 图里西斯沙漠 */
    { {0x90, 0x85, 0x92, 0x86, 0x93, 0x73, 0x8E, 0x73}, 4, {0x6C34, 0x4E2D, 0x90FD, 0x5E02}, 4 }, /* 水中都市 -> 水中都市 */
    { {0x83, 0x43, 0x83, 0x93, 0x83, 0x74, 0x83, 0x46, 0x83, 0x8B, 0x83, 0x6D, 0x8A, 0xC4, 0x8D, 0x96}, 8, {0x70BC, 0x72F1, 0x76D1, 0x72F1}, 4 }, /* インフェルノ監獄 -> 炼狱监狱 */
    { {0x82, 0x63, 0x82, 0x72, 0x8D, 0xEC, 0x90, 0xED, 0x83, 0x7C, 0x83, 0x43, 0x83, 0x93, 0x83, 0x67}, 8, {0x0044, 0x0053, 0x4F5C, 0x6218, 0x70B9}, 5 }, /* ＤＳ作戦ポイント -> DS作战点 */
    { {0x95, 0xE2, 0x8B, 0x8B, 0x98, 0x48, 0x92, 0x44, 0x8A, 0xD2, 0x83, 0x7C, 0x83, 0x43, 0x83, 0x93, 0x83, 0x67}, 9, {0x8865, 0x7ED9, 0x8DEF, 0x593A, 0x8FD8, 0x70B9}, 6 }, /* 補給路奪還ポイント -> 补给路夺还点 */
    { {0x8B, 0xC5, 0x82, 0xCC, 0x8E, 0x52, 0x92, 0xB8}, 4, {0x6653, 0x4E4B, 0x5C71, 0x9876}, 4 }, /* 暁の山頂 -> 晓之山顶 */
    { {0x83, 0x8D, 0x81, 0x5B, 0x83, 0x47, 0x83, 0x93}, 4, {0x7F57, 0x6069}, 2 }, /* ローエン -> 罗恩 */
    { {0x83, 0x8B, 0x81, 0x5B, 0x83, 0x78, 0x83, 0x93, 0x93, 0x40, 0x92, 0x6E, 0x89, 0xBA, 0x90, 0x85, 0x98, 0x48}, 9, {0x9C81, 0x672C, 0x5B85, 0x5730, 0x4E0B, 0x6C34, 0x8DEF}, 7 }, /* ルーベン邸地下水路 -> 鲁本宅地下水路 */
    { {0x83, 0x8B, 0x81, 0x5B, 0x83, 0x78, 0x83, 0x93, 0x93, 0x40, 0x82, 0x50, 0x82, 0x65}, 7, {0x9C81, 0x672C, 0x5B85, 0x0031, 0x0046}, 5 }, /* ルーベン邸１Ｆ -> 鲁本宅1F */
    { {0x83, 0x8B, 0x81, 0x5B, 0x83, 0x78, 0x83, 0x93, 0x93, 0x40, 0x82, 0x51, 0x82, 0x65}, 7, {0x9C81, 0x672C, 0x5B85, 0x0032, 0x0046}, 5 }, /* ルーベン邸２Ｆ -> 鲁本宅2F */
    { {0x83, 0x89, 0x83, 0x82, 0x83, 0x93, 0x93, 0x40}, 4, {0x62C9, 0x8499, 0x5B85, 0x90B8}, 4 }, /* ラモン邸 -> 拉蒙宅邸 */
    { {0x83, 0x6A, 0x83, 0x52, 0x83, 0x56, 0x83, 0x41, 0x82, 0xCC, 0x8B, 0xB3, 0x89, 0xEF}, 7, {0x5C3C, 0x79D1, 0x897F, 0x4E9A, 0x6559, 0x4F1A}, 6 }, /* ニコシアの教会 -> 尼科西亚教会 */
};

static void load_builtin_name_table(void) {
    int i;
    char msg[128];

    g_name_count = 0;
    for (i = 0; i < ZPGDI_BUILTIN_NAME_COUNT && g_name_count < MAX_NAMES; i++) {
        g_names[g_name_count++] = ZPGDI_BUILTIN_NAMES[i];
    }
    for (i = 0; i < (int)(sizeof(ZPGDI_MAP_NAMES) / sizeof(ZPGDI_MAP_NAMES[0])) && g_name_count < MAX_NAMES; i++) {
        g_names[g_name_count++] = ZPGDI_MAP_NAMES[i];
    }

    snprintf(msg, sizeof(msg), "ZPGDI: builtin speaker/map names loaded for diagnostics, %d names\r\n",
             g_name_count);
    log_line(msg);
}

static const NameEntry *match_name_exact(const unsigned char *run, int glyphs) {
    int i;

    for (i = 0; i < g_name_count; i++) {
        const NameEntry *e = &g_names[i];
        if (e->glyphs == glyphs && memcmp(e->sjis, run, glyphs * 2) == 0) {
            return e;
        }
    }
    return NULL;
}

/* Match run bytes (glyph pairs) against name prefixes. */
static int count_name_prefix(const unsigned char *run, int glyphs) {
    const NameEntry *first = NULL;
    int i, n = 0;

    for (i = 0; i < g_name_count; i++) {
        const NameEntry *e = &g_names[i];
        if (e->glyphs < glyphs) continue;
        if (memcmp(e->sjis, run, glyphs * 2) == 0) {
            if (!first) first = e;
            n++;
        }
    }
    (void)first;
    return n;
}

static const NameEntry *match_map_exact(const unsigned char *run, int glyphs) {
    int i;

    for (i = 0; i < (int)(sizeof(ZPGDI_MAP_NAMES) / sizeof(ZPGDI_MAP_NAMES[0])); i++) {
        const NameEntry *e = &ZPGDI_MAP_NAMES[i];
        if (e->glyphs == glyphs && memcmp(e->sjis, run, glyphs * 2) == 0) {
            return e;
        }
    }
    return NULL;
}

static int count_map_prefix(const unsigned char *run, int glyphs) {
    int i, n = 0;

    for (i = 0; i < (int)(sizeof(ZPGDI_MAP_NAMES) / sizeof(ZPGDI_MAP_NAMES[0])); i++) {
        const NameEntry *e = &ZPGDI_MAP_NAMES[i];
        if (e->glyphs < glyphs) continue;
        if (memcmp(e->sjis, run, glyphs * 2) == 0) {
            n++;
        }
    }
    return n;
}

/* Run state for consecutive glyph draws (single render thread assumed).
 * The run is match-driven rather than position-driven: name glyphs are
 * rendered once into the game's glyph cache, in order, but not necessarily
 * at increasing x positions.  The run continues while the accumulated
 * glyph sequence is still a prefix of some known name. */
static unsigned char g_run[MAX_NAME_GLYPHS * 2];
static HANDLE g_run_hdc[MAX_NAME_GLYPHS];
static int g_run_x[MAX_NAME_GLYPHS];
static int g_run_y[MAX_NAME_GLYPHS];
static int g_run_glyphs;

static void run_reset(void) {
    g_run_glyphs = 0;
}

/* A 2-byte code that looks like Shift-JIS kana/kanji rather than common GBK
 * text.  Speaker names are katakana/kanji: leads 0x81-0x9F, 0xE0-0xEF.
 * Common Simplified Chinese GBK text uses leads 0xA1-0xF7, so restricting to
 * the low SJIS lead range avoids clashing with translated body text. */
static int sjis_glyph_plausible(const unsigned char *s) {
    unsigned char lead = s[0], trail = s[1];
    if (!((lead >= 0x81 && lead <= 0x9F) || (lead >= 0xE0 && lead <= 0xEF))) return 0;
    if (trail < 0x40 || trail > 0xFC || trail == 0x7F) return 0;
    return 1;
}

static int cp932_fallback_glyph(const unsigned char *s, WCHAR *out) {
    int wlen;

    if (!s || !out || !sjis_glyph_plausible(s)) {
        return 0;
    }

    /*
     * Only auto-fallback the low SJIS lead range.  This catches most UI/kana
     * and many early-story kanji while avoiding the common GBK lead range used
     * by already-translated Simplified Chinese text.
     */
    if (s[0] < 0x81 || s[0] > 0x9F) {
        return 0;
    }

    wlen = MultiByteToWideChar(932, MB_ERR_INVALID_CHARS, (LPCSTR)s, 2, out, 2);
    if (wlen != 1) {
        return 0;
    }

    if ((*out >= 0x3000 && *out <= 0x30FF) || (*out >= 0x4E00 && *out <= 0x9FFF)) {
        return 1;
    }
    return 0;
}

static void flush_name_run_raw(void) {
    int i;

    if (!real_TextOutW) {
        run_reset();
        return;
    }
    {
        const NameEntry *e = match_name_exact(g_run, g_run_glyphs);
        if (e) {
            for (i = 0; i < g_run_glyphs; i++) {
                WCHAR wc = (i < e->cnlen) ? e->cn[i] : L' ';
                real_TextOutW(g_run_hdc[i], g_run_x[i], g_run_y[i], &wc, 1);
            }
            run_reset();
            return;
        }
    }
    for (i = 0; i < g_run_glyphs; i++) {
        WCHAR wc[2];
        int wlen = MultiByteToWideChar(932, MB_ERR_INVALID_CHARS, (LPCSTR)(g_run + i * 2), 2, wc, 2);
        if (wlen <= 0) {
            wlen = MultiByteToWideChar(936, 0, (LPCSTR)(g_run + i * 2), 2, wc, 2);
        }
        if (wlen > 0) {
            real_TextOutW(g_run_hdc[i], g_run_x[i], g_run_y[i], wc, wlen);
        }
    }
    run_reset();
}

static void emit_name_run_prefix(const NameEntry *e, int count) {
    int i;

    if (!real_TextOutW) return;
    for (i = 0; i < count && i < g_run_glyphs; i++) {
        WCHAR wc = (i < e->cnlen) ? e->cn[i] : L' ';
        real_TextOutW(g_run_hdc[i], g_run_x[i], g_run_y[i], &wc, 1);
    }
}

/* Try the sequence mapper for a single 2-byte glyph draw.
 * Returns 2 and writes *out when the current glyph should be drawn by caller.
 * Returns 1 when the glyph was consumed while waiting for a full-name match.
 * Returns 0 when normal CP936 rendering should handle it. */
static int map_name_glyph(HANDLE hdc, int x, int y, const unsigned char *s, WCHAR *out) {
    const NameEntry *e;
    int prefixes, k;

    if (!g_name_count || !sjis_glyph_plausible(s)) {
        flush_name_run_raw();
        return 0;
    }

    if (g_run_glyphs >= MAX_NAME_GLYPHS) {
        flush_name_run_raw();
    }

    g_run[g_run_glyphs * 2] = s[0];
    g_run[g_run_glyphs * 2 + 1] = s[1];
    g_run_hdc[g_run_glyphs] = hdc;
    g_run_x[g_run_glyphs] = x;
    g_run_y[g_run_glyphs] = y;
    g_run_glyphs++;

    prefixes = count_map_prefix(g_run, g_run_glyphs);
    e = match_map_exact(g_run, g_run_glyphs);
    if (e && prefixes <= 1) {
        k = g_run_glyphs - 1;
        emit_name_run_prefix(e, k);
        *out = (k < e->cnlen) ? e->cn[k] : L' ';
        run_reset();
        return 2;
    }

    if (prefixes > 0) {
        return 1;
    }

    if (g_run_glyphs > 1) {
        /* Previous run diverged; flush it raw and try starting at this glyph. */
        HANDLE cur_hdc = hdc;
        int cur_x = x, cur_y = y;
        g_run_glyphs--;
        flush_name_run_raw();
        g_run[0] = s[0];
        g_run[1] = s[1];
        g_run_hdc[0] = cur_hdc;
        g_run_x[0] = cur_x;
        g_run_y[0] = cur_y;
        g_run_glyphs = 1;
        e = match_map_exact(g_run, g_run_glyphs);
        if (e) {
            *out = e->cnlen > 0 ? e->cn[0] : L' ';
            run_reset();
            return 2;
        }
        if (count_map_prefix(g_run, g_run_glyphs) > 0) {
            return 1;
        }
    }

    run_reset();
    return 0;
}

static int map_full_name_string(const unsigned char *s, int cch, WCHAR *out, int outcap) {
    const NameEntry *e;
    const unsigned char *start;
    const unsigned char *end;
    int lead_spaces = 0;
    int trail_spaces = 0;
    int glyphs;
    int i, n = 0;

    if (!s || cch <= 0 || !out || outcap <= 0) {
        return 0;
    }

    start = s;
    end = s + cch;
    while (start < end && *start == 0x20) {
        lead_spaces++;
        start++;
    }
    while (end > start && *(end - 1) == 0x20) {
        trail_spaces++;
        end--;
    }
    if (end <= start || ((end - start) & 1)) {
        return 0;
    }

    glyphs = (int)((end - start) / 2);
    if (glyphs <= 0 || glyphs > MAX_NAME_GLYPHS) {
        return 0;
    }

    e = match_name_exact(start, glyphs);
    if (!e) {
        return 0;
    }

    for (i = 0; i < lead_spaces && n < outcap; i++) out[n++] = L' ';
    for (i = 0; i < e->cnlen && n < outcap; i++) out[n++] = e->cn[i];
    for (i = 0; i < trail_spaces && n < outcap; i++) out[n++] = L' ';
    return n;
}

/* v9: restore v6 per-glyph speaker-name mapping.  A 2-byte Shift-JIS glyph
 * that matches the built-in name-glyph table is drawn as its Chinese glyph.
 * This is the accepted trade-off: shared kana glyphs can occasionally show a
 * wrong character in unrelated words, but speaker/character names render in
 * Chinese.  Non-name glyphs fall through to the mixed CP932/CP936 decoder. */
static WCHAR lookup_name_glyph(unsigned char a, unsigned char b);
__attribute__((unused)) static WCHAR lookup_name_glyph(unsigned char a, unsigned char b) {
    int i;
    /* Skip Shift-JIS hiragana / fullwidth-latin lead 0x82: those glyphs (the
     * grammatical particle の, common kana い/お/ん..., and Ｆ/Ｚ) recur all over
     * untranslated Japanese body text.  Mapping them out of context (e.g.
     * の->囚, い->space) would wreck readability far beyond names, which are
     * katakana (lead 0x83) and kanji.  Names keep working; dialogue stays
     * readable Japanese. */
    if (a == 0x82) {
        return 0;
    }
    for (i = 0; i < ZPGDI_BUILTIN_GLYPH_COUNT; i++) {
        if (ZPGDI_BUILTIN_GLYPHS[i].sjis[0] == a &&
            ZPGDI_BUILTIN_GLYPHS[i].sjis[1] == b) {
            return ZPGDI_BUILTIN_GLYPHS[i].cn;
        }
    }
    return 0;
}

/* ------------------------------------------------------------------ */
/* GDI forwarding                                                      */
/* ------------------------------------------------------------------ */

static FARPROC load_proc(const char *name) {
    return g_gdi32 ? GetProcAddress(g_gdi32, name) : NULL;
}

static void try_load_local_fonts(void) {
    char path[MAX_PATH];
    WIN32_FIND_DATAA fd;
    HANDLE find;

    if (!real_AddFontResourceExA) {
        return;
    }

    lstrcpynA(path, g_dir[0] ? g_dir : ".", sizeof(path));
    append_path(path, "font\\*.ttf");
    find = FindFirstFileA(path, &fd);
    if (find == INVALID_HANDLE_VALUE) {
        return;
    }

    do {
        char font_path[MAX_PATH];
        lstrcpynA(font_path, g_dir[0] ? g_dir : ".", sizeof(font_path));
        append_path(font_path, "font");
        append_path(font_path, fd.cFileName);
        real_AddFontResourceExA(font_path, 0x10 /* FR_PRIVATE */, NULL);
    } while (FindNextFileA(find, &fd));

    FindClose(find);
}

static int ensure_gdi(void) {
    char path[MAX_PATH];

    if (g_gdi32) {
        return 1;
    }

    if (GetSystemDirectoryA(path, sizeof(path))) {
        append_path(path, "gdi32.dll");
        g_gdi32 = LoadLibraryA(path);
    }
    if (!g_gdi32) {
        g_gdi32 = LoadLibraryA("gdi32.dll");
    }
    if (!g_gdi32) {
        log_line("ZPGDI: failed to load real gdi32.dll\r\n");
        return 0;
    }

    real_CreateCompatibleDC = (PFN_CreateCompatibleDC)load_proc("CreateCompatibleDC");
    real_CreateDCA = (PFN_CreateDCA)load_proc("CreateDCA");
    real_CreateDIBSection = (PFN_CreateDIBSection)load_proc("CreateDIBSection");
    real_CreateFontA = (PFN_CreateFontA)load_proc("CreateFontA");
    real_CreatePalette = (PFN_CreatePalette)load_proc("CreatePalette");
    real_DeleteDC = (PFN_DeleteDC)load_proc("DeleteDC");
    real_DeleteObject = (PFN_DeleteObject)load_proc("DeleteObject");
    real_GetObjectA = (PFN_GetObjectA)load_proc("GetObjectA");
    real_SelectObject = (PFN_SelectObject)load_proc("SelectObject");
    real_SelectPalette = (PFN_SelectPalette)load_proc("SelectPalette");
    real_SetBkMode = (PFN_SetBkMode)load_proc("SetBkMode");
    real_SetTextColor = (PFN_SetTextColor)load_proc("SetTextColor");
    real_StretchDIBits = (PFN_StretchDIBits)load_proc("StretchDIBits");
    real_TextOutA = (PFN_TextOutA)load_proc("TextOutA");
    real_TextOutW = (PFN_TextOutW)load_proc("TextOutW");
    real_AddFontResourceExA = (PFN_AddFontResourceExA)load_proc("AddFontResourceExA");
    real_GetTextColor = (PFN_GetTextColor)load_proc("GetTextColor");

    try_load_local_fonts();
    log_line("ZPGDI: real gdi32 loaded\r\n");
    return 1;
}

static void log_textout(int x, int y, int cch, const unsigned char *s, int conv, int wlen, const WCHAR *wbuf) {
    LONG n = InterlockedIncrement(&g_text_log_count);
    char line[384];
    unsigned char b[8] = {0};
    int i;

    if (n > 3000) {
        return;
    }

    if (s && cch > 0) {
        int lim = cch < 8 ? cch : 8;
        for (i = 0; i < lim; i++) {
            b[i] = s[i];
        }
    }

    snprintf(line, sizeof(line),
             "TextOutA #%ld x=%d y=%d color=%06lX cch=%d bytes=%02X %02X %02X %02X %02X %02X %02X %02X conv=%d wlen=%d w0=%04X w1=%04X\r\n",
             n, x, y, (unsigned long)(g_last_color & 0xFFFFFF), cch, b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
             conv, wlen, wbuf ? (unsigned)wbuf[0] : 0, (wbuf && wlen > 1) ? (unsigned)wbuf[1] : 0);
    log_line(line);
}

BOOL WINAPI DllMain(HINSTANCE self, DWORD reason, LPVOID reserved) {
    (void)reserved;
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(self);
        init_dir(self);
        AddVectoredExceptionHandler(1, crash_handler);
        log_line("ZPGDI: loaded (v13 stable sjis/gbk no-glyph-name-map + crash log)\r\n");
        load_builtin_name_table();
    } else if (reason == DLL_PROCESS_DETACH) {
        if (g_log != INVALID_HANDLE_VALUE) {
            CloseHandle(g_log);
            g_log = INVALID_HANDLE_VALUE;
        }
    }
    return TRUE;
}

__declspec(dllexport) HANDLE WINAPI CreateCompatibleDC(HANDLE a) {
    return ensure_gdi() && real_CreateCompatibleDC ? real_CreateCompatibleDC(a) : NULL;
}

__declspec(dllexport) HANDLE WINAPI CreateDCA(LPCSTR a, LPCSTR b, LPCSTR c, const void *d) {
    return ensure_gdi() && real_CreateDCA ? real_CreateDCA(a, b, c, d) : NULL;
}

__declspec(dllexport) HANDLE WINAPI CreateDIBSection(HANDLE a, const void *b, UINT c, void **d, HANDLE e, DWORD f) {
    return ensure_gdi() && real_CreateDIBSection ? real_CreateDIBSection(a, b, c, d, e, f) : NULL;
}

__declspec(dllexport) HANDLE WINAPI CreateFontA(int h, int w, int esc, int ori, int weight,
                                                DWORD italic, DWORD underline, DWORD strike,
                                                DWORD charset, DWORD outp, DWORD clipp,
                                                DWORD quality, DWORD pitch, LPCSTR face) {
    const char *cn_face = "SimSun";
    (void)charset;
    (void)face;
    return ensure_gdi() && real_CreateFontA
        ? real_CreateFontA(h, w, esc, ori, weight, italic, underline, strike,
                           GB2312_CHARSET, outp, clipp, quality, pitch, cn_face)
        : NULL;
}

__declspec(dllexport) HANDLE WINAPI CreatePalette(const void *a) {
    return ensure_gdi() && real_CreatePalette ? real_CreatePalette(a) : NULL;
}

__declspec(dllexport) BOOL WINAPI DeleteDC(HANDLE a) {
    return ensure_gdi() && real_DeleteDC ? real_DeleteDC(a) : FALSE;
}

__declspec(dllexport) BOOL WINAPI DeleteObject(HANDLE a) {
    return ensure_gdi() && real_DeleteObject ? real_DeleteObject(a) : FALSE;
}

__declspec(dllexport) int WINAPI GetObjectA(HANDLE a, int b, LPVOID c) {
    return ensure_gdi() && real_GetObjectA ? real_GetObjectA(a, b, c) : 0;
}

__declspec(dllexport) HANDLE WINAPI SelectObject(HANDLE a, HANDLE b) {
    return ensure_gdi() && real_SelectObject ? real_SelectObject(a, b) : NULL;
}

__declspec(dllexport) HANDLE WINAPI SelectPalette(HANDLE a, HANDLE b, BOOL c) {
    return ensure_gdi() && real_SelectPalette ? real_SelectPalette(a, b, c) : NULL;
}

__declspec(dllexport) int WINAPI SetBkMode(HANDLE a, int b) {
    return ensure_gdi() && real_SetBkMode ? real_SetBkMode(a, b) : 0;
}

__declspec(dllexport) DWORD WINAPI SetTextColor(HANDLE a, DWORD b) {
    return ensure_gdi() && real_SetTextColor ? real_SetTextColor(a, b) : 0xFFFFFFFFu;
}

__declspec(dllexport) int WINAPI StretchDIBits(HANDLE a, int b, int c, int d, int e,
                                               int f, int g, int h, int i,
                                               const void *j, const void *k,
                                               UINT l, DWORD m) {
    return ensure_gdi() && real_StretchDIBits
        ? real_StretchDIBits(a, b, c, d, e, f, g, h, i, j, k, l, m)
        : 0;
}

__declspec(dllexport) BOOL WINAPI TextOutA(HANDLE hdc, int x, int y, LPCSTR s, int cch) {
    WCHAR wbuf[512];
    int wlen = 0;
    int converted = 0;

    if (!ensure_gdi()) {
        return FALSE;
    }

    g_last_color = real_GetTextColor ? (DWORD)real_GetTextColor(hdc) : 0xFFFFFFFF;

    if (s && cch > 0 && cch < 500 && real_TextOutW) {
        int mapped = map_full_name_string((const unsigned char *)s, cch, wbuf, 500);
        if (mapped > 0) {
            if (g_run_glyphs) {
                flush_name_run_raw();
            }
            log_textout(x, y, cch, (const unsigned char *)s, 7, mapped, wbuf);
            return real_TextOutW(hdc, x, y, wbuf, mapped);
        }
    }

    if (g_run_glyphs && !(s && cch == 2 && sjis_glyph_plausible((const unsigned char *)s))) {
        flush_name_run_raw();
    }

    /*
     * Per-glyph mixed decoder.
     *
     * After the game's CP936 lead-byte patch, a single TextOutA string can be:
     *   - translated Simplified Chinese (GB2312 leads 0xB0-0xF7, plus GBK
     *     extension leads that translated body text may use), or
     *   - still-untranslated Japanese Shift-JIS (kana/kanji), or
     *   - a mix (e.g. a Shift-JIS speaker marker glued onto a Chinese body).
     *
     * We can't retag the bytes, but the low Shift-JIS lead range 0x81-0x9F is
     * effectively disjoint from the GB2312 range that the Chinese translations
     * use.  So for each double-byte unit we try CP932 first ONLY when the lead
     * is 0x81-0x9F and the result is kana/kanji/fullwidth; otherwise we decode
     * the unit as CP936.  This keeps every already-correct Chinese glyph intact
     * while rendering untranslated Japanese as readable Japanese instead of
     * mojibake, and it never remaps a shared glyph out of context (no v6-style
     * pollution).
     */
    if (s && cch > 0 && cch < 500 && real_TextOutW) {
        const unsigned char *p = (const unsigned char *)s;
        int i = 0;

        wlen = 0;
        while (i < cch && wlen < 500) {
            unsigned char lead = p[i];

            if (lead >= 0x81 && lead <= 0xFE && i + 1 < cch) {
                unsigned char pair[2];
                WCHAR wc = 0;
                int done = 0;
                int mapped = 0;

                pair[0] = lead;
                pair[1] = p[i + 1];

                if (0 && cch == 2) {
                    mapped = map_name_glyph(hdc, x, y, pair, &wc);
                    if (mapped == 1) {
                        log_textout(x, y, cch, p, 8, 0, NULL);
                        return TRUE;
                    }
                    if (mapped == 2) {
                        wbuf[wlen++] = wc;
                        converted = 8;
                        done = 1;
                    }
                }

                /* Fallback decoder for non-mapped Shift-JIS/Chinese glyphs. */
                if (!done && lead >= 0x81 && lead <= 0x9F) {
                    if (MultiByteToWideChar(932, MB_ERR_INVALID_CHARS,
                                            (LPCSTR)pair, 2, &wc, 1) == 1 &&
                        ((wc >= 0x3000 && wc <= 0x30FF) ||
                         (wc >= 0x4E00 && wc <= 0x9FFF) ||
                         (wc >= 0xFF00 && wc <= 0xFFEF))) {
                        wbuf[wlen++] = wc;
                        converted = 5;
                        done = 1;
                    }
                }

                if (!done) {
                    if (MultiByteToWideChar(936, 0, (LPCSTR)pair, 2, &wc, 1) == 1) {
                        wbuf[wlen++] = wc;
                    } else {
                        wbuf[wlen++] = L'?';
                    }
                    if (!converted) converted = 1;
                }
                i += 2;
            } else {
                unsigned char one = p[i];
                WCHAR wc = 0;
                if (MultiByteToWideChar(936, 0, (LPCSTR)&one, 1, &wc, 1) == 1) {
                    wbuf[wlen++] = wc;
                } else {
                    wbuf[wlen++] = (WCHAR)one;
                }
                if (!converted) converted = 1;
                i += 1;
            }
        }

        if (wlen > 0) {
            log_textout(x, y, cch, p, converted, wlen, wbuf);
            return real_TextOutW(hdc, x, y, wbuf, wlen);
        }
    }

    log_textout(x, y, cch, (const unsigned char *)s, converted, wlen, NULL);
    return real_TextOutA ? real_TextOutA(hdc, x, y, s, cch) : FALSE;
}
