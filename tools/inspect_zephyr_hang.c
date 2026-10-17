#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <tlhelp32.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>

static int inspect_thread(DWORD pid, DWORD tid, HANDLE process) {
    HANDLE thread;
    CONTEXT ctx;
    DWORD stack[96];
    SIZE_T got = 0;
    int i;

    thread = OpenThread(THREAD_SUSPEND_RESUME | THREAD_GET_CONTEXT | THREAD_QUERY_INFORMATION, FALSE, tid);
    if (!thread) {
        fprintf(stderr, "TID %lu OpenThread failed: %lu\n", (unsigned long)tid, (unsigned long)GetLastError());
        return 0;
    }
    if (SuspendThread(thread) == (DWORD)-1) {
        fprintf(stderr, "TID %lu SuspendThread failed: %lu\n", (unsigned long)tid, (unsigned long)GetLastError());
        CloseHandle(thread);
        return 0;
    }

    ZeroMemory(&ctx, sizeof(ctx));
    ctx.ContextFlags = CONTEXT_FULL;
    if (!GetThreadContext(thread, &ctx)) {
        fprintf(stderr, "TID %lu GetThreadContext failed: %lu\n", (unsigned long)tid, (unsigned long)GetLastError());
        ResumeThread(thread);
        CloseHandle(thread);
        return 0;
    }

    ZeroMemory(stack, sizeof(stack));
    ReadProcessMemory(process, (LPCVOID)(uintptr_t)ctx.Esp, stack, sizeof(stack), &got);
    ResumeThread(thread);
    CloseHandle(thread);

    printf("THREAD tid=%lu eip=%08lX esp=%08lX ebp=%08lX eax=%08lX ebx=%08lX ecx=%08lX edx=%08lX esi=%08lX edi=%08lX stack_bytes=%lu\n",
           (unsigned long)tid, (unsigned long)ctx.Eip, (unsigned long)ctx.Esp,
           (unsigned long)ctx.Ebp, (unsigned long)ctx.Eax, (unsigned long)ctx.Ebx,
           (unsigned long)ctx.Ecx, (unsigned long)ctx.Edx, (unsigned long)ctx.Esi,
           (unsigned long)ctx.Edi, (unsigned long)got);
    for (i = 0; i < (int)(got / sizeof(DWORD)); i++) {
        if ((i % 8) == 0) printf("STACK %08lX:", (unsigned long)(ctx.Esp + i * 4));
        printf(" %08lX", (unsigned long)stack[i]);
        if ((i % 8) == 7 || i + 1 == (int)(got / sizeof(DWORD))) printf("\n");
    }
    return 1;
}

int main(int argc, char **argv) {
    DWORD pid;
    HANDLE process;
    HANDLE snap;
    THREADENTRY32 te;

    if (argc != 2) {
        fprintf(stderr, "usage: inspect_zephyr_hang.exe <pid>\n");
        return 2;
    }
    pid = (DWORD)strtoul(argv[1], NULL, 0);
    process = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, pid);
    if (!process) {
        fprintf(stderr, "OpenProcess failed: %lu\n", (unsigned long)GetLastError());
        return 1;
    }

    snap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
    if (snap == INVALID_HANDLE_VALUE) {
        fprintf(stderr, "CreateToolhelp32Snapshot failed: %lu\n", (unsigned long)GetLastError());
        CloseHandle(process);
        return 1;
    }
    ZeroMemory(&te, sizeof(te));
    te.dwSize = sizeof(te);
    if (Thread32First(snap, &te)) {
        do {
            if (te.th32OwnerProcessID == pid) inspect_thread(pid, te.th32ThreadID, process);
        } while (Thread32Next(snap, &te));
    }
    CloseHandle(snap);
    CloseHandle(process);
    return 0;
}
