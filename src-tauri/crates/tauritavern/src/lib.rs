mod app;
mod infrastructure;
mod observability_targets;
#[cfg(feature = "perf")]
pub mod perf;
mod platform;
mod presentation;
mod product;

pub fn run() {
    app::host::run();
}
