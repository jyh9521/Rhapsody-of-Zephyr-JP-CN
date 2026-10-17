#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

static int hexval(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

static int parse_hex(const char *s, unsigned char **out, SIZE_T *outlen) {
    SIZE_T n = strlen(s), i;
    unsigned char *p;
    if (!n || (n & 1)) return 0;
    p = (unsigned char *)malloc(n / 2);
    if (!p) return 0;
    for (i = 0; i < n; i += 2) {
        int a = hexval(s[i]), b = hexval(s[i + 1]);
        if (a < 0 || b < 0) { free(p); return 0; }
        p[i / 2] = (unsigned char)((a << 4) | b);
    }
    *out = p;
    *outlen = n / 2;
    return 1;
}

int main(int argc, char **argv) {
    DWORD pid;
    HANDLE process;
    unsigned char *pattern = NULL, *buf = NULL;
    SIZE_T plen = 0, chunk = 1024 * 1024, overlap, hits = 0;
    uintptr_t addr = 0;
    MEMORY_BASIC_INFORMATION mbi;

    if (argc != 3 || !parse_hex(argv[2], &pattern, &plen)) {
        fprintf(stderr, "usage: scan_zephyr_memory.exe <pid> <hex-pattern>\n");
        return 2;
    }
    pid = (DWORD)strtoul(argv[1], NULL, 0);
    process = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, pid);
    if (!process) { fprintf(stderr, "OpenProcess failed: %lu\n", (unsigned long)GetLastError()); return 1; }
    overlap = plen > 1 ? plen - 1 : 0;
    buf = (unsigned char *)malloc(chunk + overlap + 64);
    if (!buf) return 1;

    while (addr < 0x80000000u && VirtualQueryEx(process, (LPCVOID)addr, &mbi, sizeof(mbi)) == sizeof(mbi)) {
        uintptr_t base = (uintptr_t)mbi.BaseAddress;
        SIZE_T region = mbi.RegionSize;
        DWORD protect = mbi.Protect & 0xff;
        int readable = mbi.State == MEM_COMMIT && !(mbi.Protect & PAGE_GUARD) && protect != PAGE_NOACCESS;
        if (readable) {
            SIZE_T off = 0, carry = 0;
            while (off < region) {
                SIZE_T want = region - off < chunk ? region - off : chunk;
                SIZE_T got = 0, i;
                if (ReadProcessMemory(process, (LPCVOID)(base + off), buf + carry, want, &got) && got) {
                    SIZE_T total = carry + got;
                    for (i = 0; i + plen <= total; i++) {
                        if (memcmp(buf + i, pattern, plen) == 0) {
                            SIZE_T j, before = i < 24 ? i : 24, after = total - (i + plen) < 48 ? total - (i + plen) : 48;
                            uintptr_t hit = base + off - carry + i;
                            printf("HIT %08lX region=%08lX type=%08lX protect=%08lX context=", (unsigned long)hit, (unsigned long)base, (unsigned long)mbi.Type, (unsigned long)mbi.Protect);
                            for (j = i - before; j < i + plen + after; j++) printf("%02X", buf[j]);
                            printf("\n"); hits++;
                        }
                    }
                    carry = total < overlap ? total : overlap;
                    if (carry) memmove(buf, buf + total - carry, carry);
                } else carry = 0;
                off += want;
            }
        }
        if (base + region <= addr) break;
        addr = base + region;
    }
    printf("TOTAL %lu\n", (unsigned long)hits);
    free(buf); free(pattern); CloseHandle(process);
    return 0;
}
