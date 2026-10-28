//! Windows process I/O counters: bytes and calls for reads and writes. The Windows fork does not carry the
//! Linux callgrind or macOS instruction-counters paths.

use std::collections::BTreeMap;

pub type Counters = BTreeMap<&'static str, u64>;

/// Kept as a no-op boundary hook used by the perf step loop.
#[unsafe(no_mangle)]
#[inline(never)]
pub extern "C" fn tt_perf_step_boundary() {
    std::hint::black_box(());
}

#[cfg(target_os = "windows")]
pub fn snapshot() -> Result<Counters, String> {
    #[repr(C)]
    #[derive(Default)]
    struct IoCounters {
        read_operations: u64,
        write_operations: u64,
        other_operations: u64,
        read_bytes: u64,
        write_bytes: u64,
        other_bytes: u64,
    }
    unsafe extern "system" {
        fn GetCurrentProcess() -> isize;
        fn GetProcessIoCounters(process: isize, counters: *mut IoCounters) -> i32;
    }
    let mut io = IoCounters::default();
    if unsafe { GetProcessIoCounters(GetCurrentProcess(), &mut io) } == 0 {
        return Err(format!(
            "GetProcessIoCounters: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(Counters::from([
        ("readBytes", io.read_bytes),
        ("readOps", io.read_operations),
        ("writeBytes", io.write_bytes),
        ("writeOps", io.write_operations),
    ]))
}

pub fn difference(after: &Counters, before: &Counters) -> Counters {
    after
        .iter()
        .map(|(name, value)| (*name, value - before[name]))
        .collect()
}
