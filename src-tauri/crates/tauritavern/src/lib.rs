mod app;
mod infrastructure;
mod observability_targets;
mod platform;
mod presentation;
mod product;

pub fn run() {
    app::host::run();
}
