use anyhow::{Context, Result};
use chrono::Local;
use colored::*;
use dialoguer::{theme::ColorfulTheme, Select};
use indicatif::{ProgressBar, ProgressStyle};
use regex::Regex;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::Path;
use std::process::{Command, ExitStatus, Stdio};
use std::time::Duration;
use sysinfo::System;
use which::which;

mod artifacts;
mod upsync;

const TAOBAO_REGISTRY: &str = "https://registry.npmmirror.com";

#[derive(Debug, Clone, Copy)]
enum IosPolicyProfileSelection {
    Full,
    IosInternalFull,
    IosExternalBeta,
}

impl IosPolicyProfileSelection {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Full => "full",
            Self::IosInternalFull => "ios_internal_full",
            Self::IosExternalBeta => "ios_external_beta",
        }
    }
}

fn prompt_ios_policy_profile(action: &str) -> Result<Option<IosPolicyProfileSelection>> {
    let selections = &[
        "✅ full (default: unrestricted)",
        "🧪 ios_internal_full (internal: full feature set, startup update check disabled by default)",
        "🚦 ios_external_beta (external beta: review-safe trimming by default, unlockable by an imported override)",
        "🔙 Back",
    ];

    let selection = Select::with_theme(&ColorfulTheme::default())
        .with_prompt(format!("{}: Select iOS Policy Profile", action))
        .default(0)
        .items(&selections[..])
        .interact()?;

    match selection {
        0 => Ok(Some(IosPolicyProfileSelection::Full)),
        1 => Ok(Some(IosPolicyProfileSelection::IosInternalFull)),
        2 => Ok(Some(IosPolicyProfileSelection::IosExternalBeta)),
        _ => Ok(None),
    }
}

// Logging helpers
fn log_info(msg: &str) {
    let time = Local::now().format("%H:%M:%S").to_string();
    println!(
        "{} {} {}",
        format!("[{}]", time).dimmed(),
        "INFO".cyan().bold(),
        msg
    );
}

fn log_success(msg: &str) {
    let time = Local::now().format("%H:%M:%S").to_string();
    println!(
        "{} {} {}",
        format!("[{}]", time).dimmed(),
        "SUCCESS".green().bold(),
        msg
    );
}

fn log_warn(msg: &str) {
    let time = Local::now().format("%H:%M:%S").to_string();
    println!(
        "{} {} {}",
        format!("[{}]", time).dimmed(),
        "WARN".yellow().bold(),
        msg
    );
}

fn log_error(msg: &str) {
    let time = Local::now().format("%H:%M:%S").to_string();
    println!(
        "{} {} {}",
        format!("[{}]", time).dimmed(),
        "ERROR".red().bold(),
        msg
    );
}

fn main() -> Result<()> {
    // Enable ANSI colour support on Windows
    #[cfg(windows)]
    let _ = colored::control::set_virtual_terminal(true);

    let cli_args: Vec<String> = env::args().skip(1).collect();
    if !cli_args.is_empty() {
        if let Err(error) = run_cli_command(&cli_args) {
            eprintln!("ERROR: {:#}", error);
            std::process::exit(1);
        }
        return Ok(());
    }

    clear_terminal();
    print_banner();

    // Capture the result of run_app with match so that a panic or a direct exit cannot close the window
    match run_app() {
        Ok(_) => Ok(()),
        Err(e) => {
            handle_error(e);
            Ok(())
        }
    }
}

fn run_cli_command(args: &[String]) -> Result<()> {
    match args {
        [command, subcommand, rest @ ..] if command == "upsync" && subcommand == "analyze" => {
            upsync::run_upsync_analyze_cli(rest)
        }
        [flag] if flag == "--help" || flag == "-h" => {
            print_cli_help();
            Ok(())
        }
        _ => {
            print_cli_help();
            Err(anyhow::anyhow!("Unsupported command: {}", args.join(" ")))
        }
    }
}

fn print_cli_help() {
    println!("FasTools CLI");
    println!();
    println!("Usage:");
    println!("  fastools upsync analyze [options]");
    println!();
    println!("Run `fastools upsync analyze --help` for detailed options.");
}

fn handle_error(e: anyhow::Error) {
    println!();
    println!(
        "{}",
        "┌──────────────────────────────────────────────────────┐"
            .red()
            .bold()
    );
    println!(
        "{} {:^52} {}",
        "│".red().bold(),
        "🛑 Launcher Error 🛑".white().bold(),
        "│".red().bold()
    );
    println!(
        "{}",
        "└──────────────────────────────────────────────────────┘"
            .red()
            .bold()
    );
    println!();
    log_error(&format!("Error details: {:?}", e));
    println!();
    pause();
    std::process::exit(1);
}

fn run_app() -> Result<()> {
    // 1. Environment check
    step_header(1, 3, "Environment Check");
    check_environment()?;

    // 2. Dependency management
    step_header(2, 3, "Dependency Management");
    check_and_install_dependencies()?;

    // 3. Main menu
    step_header(3, 3, "Main Menu");
    loop {
        if !show_menu()? {
            break;
        }
    }

    Ok(())
}

fn print_banner() {
    let banner_lines = [
        r#"████████╗ █████╗ ██╗   ██╗██████╗ ██╗████████╗ █████╗ ██╗   ██╗███████╗██████╗ ███╗   ██╗"#,
        r#"╚══██╔══╝██╔══██╗██║   ██║██╔══██╗██║╚══██╔══╝██╔══██╗██║   ██║██╔════╝██╔══██╗████╗  ██║"#,
        r#"   ██║   ███████║██║   ██║██████╔╝██║   ██║   ███████║██║   ██║█████╗  ██████╔╝██╔██╗ ██║"#,
        r#"   ██║   ██╔══██║██║   ██║██╔══██╗██║   ██║   ██╔══██║╚██╗ ██╔╝██╔══╝  ██╔══██╗██║╚██╗██║"#,
        r#"   ██║   ██║  ██║╚██████╔╝██║  ██║██║   ██║   ██║  ██║ ╚████╔╝ ███████╗██║  ██║██║ ╚████║"#,
        r#"   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝   ╚═╝   ╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝"#,
    ];

    // Gradient stops (R, G, B): bright cyan fading into deep cyan for a sense of depth
    let colors = [
        (80, 255, 255),
        (60, 235, 255),
        (40, 215, 255),
        (20, 195, 255),
        (0, 175, 255),
        (0, 155, 255),
    ];

    println!();
    for (i, line) in banner_lines.iter().enumerate() {
        let (r, g, b) = colors.get(i).unwrap_or(&(0, 255, 255));
        println!("{}", line.truecolor(*r, *g, *b).bold());
    }

    println!();
    println!(
        "{}",
        "        >>> FasTools (TauriTavern Manager) <<<        "
            .truecolor(220, 220, 220)
            .bold()
    );
    println!(
        "{}",
        "   -----------------------------------------------------   ".dimmed()
    );
    println!();
}

fn step_header(current: usize, total: usize, title: &str) {
    let bar_len = 20;
    let filled = (current as f64 / total as f64 * bar_len as f64) as usize;
    let bar = "█".repeat(filled) + &"░".repeat(bar_len - filled);

    println!();
    println!(
        "{} {} {} {} {}",
        "🔵".blue(),
        bar.blue().bold(),
        "".clear(),
        format!("{}/{}", current, total).bold(),
        title.white().bold(),
    );
    println!("{}", "─".repeat(60).dimmed());
}

fn check_environment() -> Result<()> {
    log_info("Running the environment self-check...");

    // Check Node.js
    if which("node").is_err() {
        log_error("Node.js was not found!");
        println!(
            "Download and install it from https://nodejs.org/ (the LTS release is recommended)."
        );
        println!("Run this launcher again once the installation finishes.");
        pause();
        std::process::exit(1);
    } else {
        log_success("Node.js is installed");
    }

    // Check Rust (cargo)
    if which("cargo").is_err() {
        log_error("Rust (cargo) was not found!");
        println!("Tauri needs a Rust toolchain. Install one from https://rustup.rs/.");
        pause();
        std::process::exit(1);
    } else {
        log_success("Rust (cargo) is installed");
    }

    // Check WebView2 (Windows only)
    #[cfg(windows)]
    if !check_webview2()? {
        pause();
        std::process::exit(1);
    }

    // Check pnpm
    if which("pnpm").is_err() {
        log_warn("pnpm was not found, trying to install it through npm...");
        install_pnpm()?;
    } else {
        log_success("pnpm is installed");
    }

    log_success("Environment check passed!");
    println!();
    Ok(())
}

#[cfg(windows)]
fn check_webview2() -> Result<bool> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let subkey_path = "SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    let subkey_path_64 =
        "SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

    let has_webview2 =
        hklm.open_subkey(subkey_path).is_ok() || hklm.open_subkey(subkey_path_64).is_ok();

    if has_webview2 {
        log_success("WebView2 Runtime is installed");
        Ok(true)
    } else {
        log_error("WebView2 Runtime was not detected!");
        println!("Running a Tauri application on Windows requires the WebView2 Runtime.");
        println!("Download the Evergreen Bootstrapper from https://developer.microsoft.com/microsoft-edge/webview2/.");
        println!("Or install it directly: https://go.microsoft.com/fwlink/p/?LinkId=2124703");
        Ok(false)
    }
}

fn install_pnpm() -> Result<()> {
    let spinner = ProgressBar::new_spinner();
    spinner.set_style(
        ProgressStyle::default_spinner()
            .tick_chars("⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏")
            .template("{spinner:.green} {msg}")?,
    );
    spinner.set_message("Installing pnpm...");
    spinner.enable_steady_tick(Duration::from_millis(100));

    let status = Command::new(get_cmd("npm"))
        .args(["install", "-g", "pnpm", "--registry", TAOBAO_REGISTRY])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .context("failed to run npm install -g pnpm")?;

    spinner.finish_and_clear();

    if status.success() {
        log_success("pnpm was installed successfully!");
        Ok(())
    } else {
        log_error("pnpm installation failed!");
        println!("Try running this by hand: npm install -g pnpm --registry=https://registry.npmmirror.com");
        Err(anyhow::anyhow!("pnpm installation failed"))
    }
}

fn check_and_install_dependencies() -> Result<()> {
    let mut root_dir = env::current_dir()?;
    if !root_dir.join("package.json").exists() {
        if root_dir.join("../package.json").exists() {
            root_dir = root_dir.parent().unwrap().to_path_buf();
            env::set_current_dir(&root_dir)?;
        } else {
            if root_dir.ends_with("launcher") {
                root_dir = root_dir.parent().unwrap().to_path_buf();
                env::set_current_dir(&root_dir)?;
            }
        }
    }

    if !Path::new("package.json").exists() {
        return Err(anyhow::anyhow!(
            "Could not find the project root (no package.json was found)"
        ));
    }

    // Check node_modules
    if !Path::new("node_modules").exists() {
        log_warn("Dependencies are missing, preparing to install them...");

        if which("npm").is_ok() {
            log_info("Pointing npm at the Taobao registry mirror...");
            let _ = Command::new(get_cmd("npm"))
                .args(["config", "set", "registry", TAOBAO_REGISTRY])
                .output();
        } else {
            log_warn("npm was not detected, skipping the registry mirror setup");
        }

        let spinner = ProgressBar::new_spinner();
        spinner.set_style(
            ProgressStyle::default_spinner()
                .tick_chars("⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏")
                .template("{spinner:.green} {msg}")?,
        );
        spinner.set_message("Installing dependencies (pnpm install)... this can take a while");
        spinner.enable_steady_tick(Duration::from_millis(100));

        let status = run_sequential_attempts(&[
            ("pnpm", vec!["install"]),
            ("corepack", vec!["enable"]),
            ("corepack", vec!["pnpm", "install"]),
            ("npm", vec!["install"]),
        ])?;

        spinner.finish_and_clear();

        if status.success() {
            log_success("Dependencies installed!");
        } else {
            log_error("Dependency installation failed!");
            println!("Run `pnpm install` by hand in a terminal to see the full error.");
            return Err(anyhow::anyhow!("dependency installation failed"));
        }
    } else {
        log_success("Dependencies are ready");
    }
    println!();
    Ok(())
}

fn run_sequential_attempts(candidates: &[(&str, Vec<&str>)]) -> Result<ExitStatus> {
    let mut last_err: Option<anyhow::Error> = None;
    for (prog, args) in candidates {
        // Handle the .cmd suffix automatically on Windows
        let cmd_prog = get_cmd(prog);

        match Command::new(&cmd_prog)
            .args(args)
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status()
        {
            Ok(status) => {
                if *prog == "corepack" && args.as_slice() == ["enable"] && !status.success() {
                    continue;
                }
                return Ok(status);
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // If the .cmd name was not found either, retry without the suffix (the user may be on Git Bash or Cygwin)
                if cfg!(windows) && *prog != "corepack" {
                    // corepack is normally a .cmd shim as well
                    if let Ok(status) = Command::new(prog)
                        .args(args)
                        .stdout(Stdio::inherit())
                        .stderr(Stdio::inherit())
                        .status()
                    {
                        return Ok(status);
                    }
                }

                log_warn(&format!(
                    "Executable not found: {}, trying the next option...",
                    prog
                ));
                last_err = Some(e.into());
                continue;
            }
            Err(e) => {
                last_err = Some(e.into());
                continue;
            }
        }
    }
    Err(anyhow::anyhow!(
        "No usable package manager was found, or running it failed; install pnpm or npm and retry"
    )
    .context(last_err.unwrap_or_else(|| anyhow::anyhow!("unknown error"))))
}

// Helper: append the .cmd suffix automatically on Windows
fn get_cmd(cmd: &str) -> String {
    if cfg!(windows) {
        // npm, pnpm and corepack are normally .cmd batch files on Windows
        match cmd {
            "npm" | "pnpm" | "corepack" => format!("{}.cmd", cmd),
            _ => cmd.to_string(),
        }
    } else {
        cmd.to_string()
    }
}

fn show_menu() -> Result<bool> {
    let selections = &[
        "🚀 Start Dev Mode (Dev)",
        "📱 Start Android Dev Mode (Android Dev)",
        "🍎 Start iOS Dev Mode (iOS Dev)",
        "🔨 Build Production Release (Build)",
        "⭐ Check for Updates (Git Pull)",
        "🧰 Toolbox",
        "🔧 Debug Tools",
        "🔙 Exit",
    ];

    let selection = Select::with_theme(&ColorfulTheme::default())
        .with_prompt("FasTools")
        .default(0)
        .items(&selections[..])
        .interact()?;

    match selection {
        0 => {
            run_dev()?;
            Ok(true) // Keep looping
        }
        1 => {
            run_android_dev()?;
            Ok(true)
        }
        2 => {
            run_ios_dev()?;
            Ok(true)
        }
        3 => {
            show_build_menu()?;
            Ok(true)
        }
        4 => {
            update_repository()?;
            Ok(true)
        }
        5 => {
            show_toolbox_menu()?;
            Ok(true)
        }
        6 => {
            show_debug_menu()?;
            Ok(true)
        }
        _ => Ok(false), // Exit
    }
}

fn show_toolbox_menu() -> Result<()> {
    loop {
        let selections = &[
            "📦 Back Up Data (Backup Data)",
            "🧹 Clear the WebView2 Cache (Clean Cache)",
            "🗑️ Clean Environment in One Go (Clean Environment)",
            "🔙 Back to Main Menu",
        ];

        let selection = Select::with_theme(&ColorfulTheme::default())
            .with_prompt("Toolbox")
            .default(0)
            .items(&selections[..])
            .interact()?;

        match selection {
            0 => backup_data()?,
            1 => clean_webview2_cache()?,
            2 => clean_environment()?,
            _ => break,
        }
    }
    Ok(())
}

fn backup_data() -> Result<()> {
    log_info("Backing up data...");

    // Locate the data directory intelligently
    // 1. Check the current directory (Portable Mode / Released App)
    // 2. Check the parent directory (Dev Environment)
    // 3. Check the system default data directory (Global Mode)
    let mut data_dir = Path::new("data").to_path_buf();
    let mut found = false;

    if data_dir.exists() {
        found = true;
    } else if Path::new("../data").exists() {
        data_dir = Path::new("../data").to_path_buf();
        found = true;
    } else {
        // Global path detection
        let global_path = if cfg!(target_os = "windows") {
            env::var("APPDATA")
                .ok()
                .map(|p| Path::new(&p).join("com.tauritavern.client").join("data"))
        } else if cfg!(target_os = "macos") {
            env::var("HOME").ok().map(|p| {
                Path::new(&p).join("Library/Application Support/com.tauritavern.client/data")
            })
        } else {
            // Linux: XDG_CONFIG_HOME or ~/.config
            env::var("XDG_CONFIG_HOME")
                .ok()
                .map(|p| Path::new(&p).join("com.tauritavern.client/data"))
                .or_else(|| {
                    env::var("HOME")
                        .ok()
                        .map(|p| Path::new(&p).join(".config/com.tauritavern.client/data"))
                })
        };

        if let Some(path) = global_path {
            if path.exists() {
                data_dir = path;
                found = true;
            }
        }
    }

    if !found {
        log_warn("No data directory was found (checked ./data, ../data and the system default paths), so there is nothing to back up.");
        pause();
        return Ok(());
    }

    log_info(&format!("Data directory located at: {:?}", data_dir));

    // Create the backups directory
    if !Path::new("backups").exists() {
        fs::create_dir("backups")?;
    }

    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let backup_file = format!("backups/backup_{}.zip", timestamp); // Use a relative path

    // Resolve the absolute path of data_dir for display and archiving
    let abs_data_dir = fs::canonicalize(&data_dir)?;
    log_info(&format!(
        "Creating a backup: {} -> {}",
        abs_data_dir.display(),
        backup_file
    ));

    #[cfg(windows)]
    {
        // Compress with PowerShell's Compress-Archive
        let status = Command::new("powershell")
            .arg("Compress-Archive")
            .arg("-Path")
            .arg(&abs_data_dir)
            .arg("-DestinationPath")
            .arg(&backup_file)
            .arg("-Force")
            .status();

        match status {
            Ok(s) => {
                if s.success() {
                    log_success("Backup succeeded!");
                } else {
                    log_error(
                        "Backup failed; check the PowerShell version and the free disk space.",
                    );
                }
            }
            Err(e) => {
                log_error(&format!("Could not run PowerShell: {}", e));
            }
        }
    }

    #[cfg(not(windows))]
    {
        // On Linux/macOS, archive with tar (tar -czf backup.tar.gz -C parent_dir dir_name)
        let backup_file_tar = format!("backups/backup_{}.tar.gz", timestamp);

        // Resolve the parent directory and the directory name
        let parent = abs_data_dir.parent().unwrap_or(Path::new("/"));
        let dirname = abs_data_dir.file_name().unwrap();

        let status = Command::new("tar")
            .arg("-czf")
            .arg(&backup_file_tar)
            .arg("-C")
            .arg(parent)
            .arg(dirname)
            .status();

        match status {
            Ok(s) => {
                if s.success() {
                    log_success(&format!("Backup succeeded! File: {}", backup_file_tar));
                } else {
                    log_error("Backup failed; check the tar command and the free disk space.");
                }
            }
            Err(e) => {
                log_error(&format!("Could not run tar: {}", e));
            }
        }
    }

    pause();
    Ok(())
}

fn clean_webview2_cache() -> Result<()> {
    #[cfg(windows)]
    let cache_name = "the WebView2 cache";
    #[cfg(not(windows))]
    let cache_name = "the application cache";

    log_warn(&format!("Clearing {}...", cache_name));
    println!("Make sure TauriTavern is fully closed, otherwise the cleanup will fail.");

    let cache_path = if cfg!(target_os = "windows") {
        env::var("LOCALAPPDATA")
            .ok()
            .map(|p| Path::new(&p).join("com.tauritavern.client/EBWebView"))
    } else if cfg!(target_os = "macos") {
        env::var("HOME")
            .ok()
            .map(|p| Path::new(&p).join("Library/Caches/com.tauritavern.client"))
    } else {
        // Linux
        env::var("XDG_CACHE_HOME")
            .ok()
            .map(|p| Path::new(&p).join("com.tauritavern.client"))
            .or_else(|| {
                env::var("HOME")
                    .ok()
                    .map(|p| Path::new(&p).join(".cache/com.tauritavern.client"))
            })
    };

    if let Some(path) = cache_path {
        if !path.exists() {
            log_info("No cache directory was found, so there is nothing to clean.");
            pause();
            return Ok(());
        }

        print!("  Deleting the cache directory: {:?}... ", path);
        match fs::remove_dir_all(&path) {
            Ok(_) => println!("{}", "✅".green()),
            Err(e) => {
                println!("{}", "❌".red());
                log_error(&format!("Deletion failed: {}", e));
                println!("  (the program may still be running; close it and retry)");
            }
        }
    } else {
        #[cfg(not(windows))]
        log_info("Automatic WebView cache cleanup is not supported on this platform (it is rarely needed)");
        #[cfg(windows)]
        log_error("Could not locate the cache directory.");
    }

    pause();
    Ok(())
}

fn run_dev() -> Result<()> {
    log_info("Starting Tauri dev mode...");

    let status = run_sequential_attempts(&[
        ("pnpm", vec!["run", "tauri:dev:pilot"]),
        ("corepack", vec!["pnpm", "run", "tauri:dev:pilot"]),
        ("npm", vec!["run", "tauri:dev:pilot"]),
    ])?;

    if !status.success() {
        log_error("The dev server failed to start");
        pause();
    }
    Ok(())
}

fn run_android_dev() -> Result<()> {
    log_info("Starting Android dev mode...");

    let status = run_sequential_attempts(&[
        ("pnpm", vec!["run", "android:dev"]),
        ("corepack", vec!["pnpm", "run", "android:dev"]),
        ("npm", vec!["run", "android:dev"]),
    ])?;

    if !status.success() {
        log_error("Android dev mode failed to start");
        pause();
    }
    Ok(())
}

fn run_ios_dev() -> Result<()> {
    let Some(profile) = prompt_ios_policy_profile("iOS Dev")? else {
        return Ok(());
    };

    log_info(&format!(
        "Starting iOS dev mode... (policy: {})",
        profile.as_str()
    ));

    let status = run_sequential_attempts(&[
        (
            "pnpm",
            vec!["run", "ios:dev:policy", "--", "--profile", profile.as_str()],
        ),
        (
            "corepack",
            vec![
                "pnpm",
                "run",
                "ios:dev:policy",
                "--",
                "--profile",
                profile.as_str(),
            ],
        ),
        (
            "npm",
            vec!["run", "ios:dev:policy", "--", "--profile", profile.as_str()],
        ),
    ])?;

    if !status.success() {
        log_error("iOS dev mode failed to start");
        pause();
    }
    Ok(())
}

fn show_build_menu() -> Result<()> {
    loop {
        let selections = &[
            "🖥️ Desktop Build",
            "🐞 Desktop Debug Build",
            "🤖 Android Build (CI ABI)",
            "🍎 iOS Build",
            "📦 Portable Build",
            "🔙 Back to Main Menu",
        ];

        let selection = Select::with_theme(&ColorfulTheme::default())
            .with_prompt("Build Production Release")
            .default(0)
            .items(&selections[..])
            .interact()?;

        match selection {
            0 => run_desktop_build()?,
            1 => run_desktop_build_debug()?,
            2 => run_android_build_split_abi()?,
            3 => run_ios_build()?,
            4 => run_portable_build()?,
            _ => break,
        }
    }
    Ok(())
}

fn run_desktop_build() -> Result<()> {
    log_info("Building the desktop production release...");

    let status = run_sequential_attempts(&[
        ("pnpm", vec!["run", "tauri:build"]),
        ("corepack", vec!["pnpm", "run", "tauri:build"]),
        ("npm", vec!["run", "tauri:build"]),
    ])?;

    if status.success() {
        report_collected_artifacts(artifacts::BuildArtifactsKind::DesktopRelease)?;
        pause();
    } else {
        log_error("Build failed");
        pause();
    }
    Ok(())
}

fn run_desktop_build_debug() -> Result<()> {
    log_info("Building the desktop Debug release...");
    let bundles = if cfg!(target_os = "windows") {
        "nsis"
    } else if cfg!(target_os = "macos") {
        "dmg"
    } else {
        "appimage,deb,rpm"
    };
    let status = run_sequential_attempts(&[
        (
            "pnpm",
            vec!["run", "tauri:build", "--", "--debug", "--bundles", bundles],
        ),
        (
            "corepack",
            vec![
                "pnpm",
                "run",
                "tauri:build",
                "--",
                "--debug",
                "--bundles",
                bundles,
            ],
        ),
        (
            "npm",
            vec!["run", "tauri:build", "--", "--debug", "--bundles", bundles],
        ),
    ])?;

    if status.success() {
        report_collected_artifacts(artifacts::BuildArtifactsKind::DesktopDebug)?;
    } else {
        log_error("Build failed");
    }

    pause();
    Ok(())
}

fn run_android_build_split_abi() -> Result<()> {
    log_info("Building the Android production release (CI ABI: arm64-v8a + armeabi-v7a)...");

    let status = run_sequential_attempts(&[
        (
            "pnpm",
            vec![
                "run",
                "android:build",
                "--",
                "--verbose",
                "--apk",
                "--split-per-abi",
                "--target",
                "aarch64",
                "armv7",
            ],
        ),
        (
            "corepack",
            vec![
                "pnpm",
                "run",
                "android:build",
                "--",
                "--verbose",
                "--apk",
                "--split-per-abi",
                "--target",
                "aarch64",
                "armv7",
            ],
        ),
        (
            "npm",
            vec![
                "run",
                "android:build",
                "--",
                "--verbose",
                "--apk",
                "--split-per-abi",
                "--target",
                "aarch64",
                "armv7",
            ],
        ),
    ])?;

    if status.success() {
        report_collected_artifacts(artifacts::BuildArtifactsKind::AndroidSplitApk)?;
        pause();
    } else {
        log_error("Build failed");
        pause();
    }
    Ok(())
}

fn run_ios_build() -> Result<()> {
    let Some(profile) = prompt_ios_policy_profile("iOS Build")? else {
        return Ok(());
    };

    log_info(&format!(
        "Building the iOS production release... (policy: {})",
        profile.as_str()
    ));

    let status = run_sequential_attempts(&[
        (
            "pnpm",
            vec![
                "run",
                "ios:build:policy",
                "--",
                "--profile",
                profile.as_str(),
                "--verbose",
            ],
        ),
        (
            "corepack",
            vec![
                "pnpm",
                "run",
                "ios:build:policy",
                "--",
                "--profile",
                profile.as_str(),
                "--verbose",
            ],
        ),
        (
            "npm",
            vec![
                "run",
                "ios:build:policy",
                "--",
                "--profile",
                profile.as_str(),
                "--verbose",
            ],
        ),
    ])?;

    if status.success() {
        report_collected_artifacts(artifacts::BuildArtifactsKind::IosRelease {
            testflight: matches!(profile, IosPolicyProfileSelection::IosExternalBeta),
        })?;
        pause();
    } else {
        log_error("Build failed");
        pause();
    }
    Ok(())
}

fn run_portable_build() -> Result<()> {
    log_info("Building the portable production release...");

    let status = run_sequential_attempts(&[
        ("pnpm", vec!["run", "tauri:build:portable"]),
        ("corepack", vec!["pnpm", "run", "tauri:build:portable"]),
        ("npm", vec!["run", "tauri:build:portable"]),
    ])?;

    if status.success() {
        log_success("Build succeeded! The portable build was written to release/");
        pause();
    } else {
        log_error("Build failed");
        pause();
    }
    Ok(())
}

fn report_collected_artifacts(kind: artifacts::BuildArtifactsKind) -> Result<()> {
    let artifacts = artifacts::collect(Path::new("."), kind)?;
    log_success("Build succeeded! Release artifacts were collected into release/");
    for artifact in artifacts {
        println!("  - {}", artifact.destination().display());
    }
    Ok(())
}

fn clean_environment() -> Result<()> {
    log_warn("Cleaning the environment...");

    // Remove node_modules
    if Path::new("node_modules").exists() {
        print!("  Removing node_modules... ");
        match fs::remove_dir_all("node_modules") {
            Ok(_) => println!("{}", "✅".green()),
            Err(e) => {
                println!("{}", "❌".red());
                println!("  Removal failed: {}", e);
            }
        }
    } else {
        log_info("node_modules does not exist, skipping.");
    }

    // Remove src-tauri/target
    if Path::new("src-tauri/target").exists() {
        print!("  Removing src-tauri/target... ");
        match fs::remove_dir_all("src-tauri/target") {
            Ok(_) => println!("{}", "✅".green()),
            Err(e) => {
                println!("{}", "❌".red());
                println!("  Removal failed: {}", e);
            }
        }
    } else {
        log_info("src-tauri/target does not exist, skipping.");
    }

    // Dependencies have to be reinstalled after cleaning
    log_info("Cleanup finished, reinstalling dependencies...");
    check_and_install_dependencies()?;

    pause();
    Ok(())
}

fn update_repository() -> Result<()> {
    log_info("Checking for updates...");

    if !Path::new(".git").exists() {
        log_warn(
            "The current directory is not a Git repository, so it cannot be updated automatically.",
        );
        pause();
        return Ok(());
    }

    let status = Command::new("git").args(["pull"]).status();

    match status {
        Ok(s) => {
            if s.success() {
                log_success("Update succeeded!");
            } else {
                log_error("Update failed; check the network connection and the Git state.");
            }
        }
        Err(_) => {
            log_error("The git command was not found. Install Git first.");
        }
    }
    pause();
    Ok(())
}

fn pause() {
    println!("\nPress Enter to continue...");
    let _ = std::io::stdin().read_line(&mut String::new());
}

fn clear_terminal() {
    print!("\x1B[2J\x1B[1;1H");
}

fn show_debug_menu() -> Result<()> {
    loop {
        let selections = &[
            "🐞 Start Debug Mode (Debug Mode)",
            "👀 View Live Logs (View Logs)",
            "💀 Force-Kill Processes (Kill Process)",
            "🔍 Check Port Usage (Check Port)",
            "ℹ️ System Environment Information (System Info)",
            "⚙️ Inspect Config File (Inspect Config)",
            "🔙 Back to Main Menu",
        ];

        let selection = Select::with_theme(&ColorfulTheme::default())
            .with_prompt("Debug Tools")
            .default(0)
            .items(&selections[..])
            .interact()?;

        match selection {
            0 => run_debug()?,
            1 => view_logs()?,
            2 => kill_process()?,
            3 => check_port()?,
            4 => sys_info()?,
            5 => inspect_config()?,
            _ => break,
        }
    }
    Ok(())
}

fn inspect_config() -> Result<()> {
    log_info("Reading the Tauri configuration file...");

    let config_path = if Path::new("src-tauri/crates/tauritavern/tauri.conf.json").exists() {
        Path::new("src-tauri/crates/tauritavern/tauri.conf.json").to_path_buf()
    } else if Path::new("../src-tauri/crates/tauritavern/tauri.conf.json").exists() {
        Path::new("../src-tauri/crates/tauritavern/tauri.conf.json").to_path_buf()
    } else {
        log_warn("The tauri.conf.json configuration file was not found.");
        pause();
        return Ok(());
    };

    let content = fs::read_to_string(&config_path)?;
    let json: serde_json::Value =
        serde_json::from_str(&content).context("failed to parse tauri.conf.json")?;

    println!();
    println!("{}", "--- Tauri Config Overview ---".cyan().bold());

    if let Some(name) = json.get("productName").and_then(|v| v.as_str()) {
        println!("📦 Product name:   {}", name.green());
    }
    if let Some(version) = json.get("version").and_then(|v| v.as_str()) {
        println!("🔖 Version:        {}", version.yellow());
    }
    if let Some(id) = json.get("identifier").and_then(|v| v.as_str()) {
        println!("🆔 Identifier:     {}", id);
    }

    // Build config
    if let Some(build) = json.get("build") {
        if let Some(dist) = build.get("frontendDist").and_then(|v| v.as_str()) {
            println!("📂 Frontend dist:  {}", dist);
        }
        if let Some(dev) = build.get("devUrl").and_then(|v| v.as_str()) {
            println!("🌐 Dev URL:        {}", dev);
        }
    }

    println!();
    log_success(&format!("Config file path: {:?}", config_path));

    pause();
    Ok(())
}

fn view_logs() -> Result<()> {
    log_info("Looking for log files...");

    // Locate the logs directory intelligently
    let mut log_dir = Path::new("logs").to_path_buf();
    let mut found = false;

    if log_dir.exists() {
        found = true;
    } else if Path::new("../logs").exists() {
        log_dir = Path::new("../logs").to_path_buf();
        found = true;
    } else {
        // Global path detection
        let global_path = if cfg!(target_os = "windows") {
            env::var("APPDATA")
                .ok()
                .map(|p| Path::new(&p).join("com.tauritavern.client").join("logs"))
        } else if cfg!(target_os = "macos") {
            env::var("HOME")
                .ok()
                .map(|p| Path::new(&p).join("Library/Logs/com.tauritavern.client"))
        } else {
            // Linux: XDG_DATA_HOME or ~/.local/share
            env::var("XDG_DATA_HOME")
                .ok()
                .map(|p| Path::new(&p).join("com.tauritavern.client/logs"))
                .or_else(|| {
                    env::var("HOME")
                        .ok()
                        .map(|p| Path::new(&p).join(".local/share/com.tauritavern.client/logs"))
                })
        };

        if let Some(path) = global_path {
            if path.exists() {
                log_dir = path;
                found = true;
            }
        }
    }

    if !found {
        log_warn(
            "No logs directory was found (checked ./logs, ../logs and the system default paths).",
        );
        pause();
        return Ok(());
    }

    log_info(&format!("Logs directory located at: {:?}", log_dir));

    // Find the newest log file
    let mut entries: Vec<_> = fs::read_dir(&log_dir)?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            name_str.starts_with("tauritavern.log")
        })
        .collect();

    if entries.is_empty() {
        log_warn("No tauritavern.log* file was found in that directory.");
        pause();
        return Ok(());
    }

    // Sort by modification time, newest first
    entries.sort_by_key(|entry| {
        std::cmp::Reverse(
            entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH),
        )
    });

    let log_file_path = entries[0].path();
    log_success(&format!("Opening the newest log: {:?}", log_file_path));

    // Read and show the last 50 lines
    let file = fs::File::open(&log_file_path)?;
    let reader = BufReader::new(file);
    let lines: Vec<String> = reader.lines().map_while(Result::ok).collect();

    let start = if lines.len() > 50 {
        lines.len() - 50
    } else {
        0
    };
    println!();
    println!("{}", "--- Last 50 log lines ---".dimmed());
    for line in &lines[start..] {
        println!("{}", line);
    }
    println!("{}", "---------------------".dimmed());

    pause();
    Ok(())
}

fn kill_process() -> Result<()> {
    log_warn("Scanning for related processes...");
    let mut sys = System::new_all();
    sys.refresh_all();

    let target_names = if cfg!(windows) {
        vec!["TauriTavern.exe", "tauritavern.exe"]
    } else {
        vec!["tauritavern", "TauriTavern"]
    };

    let mut killed = 0;
    for process in sys.processes().values() {
        let name = process.name().to_string_lossy();
        // On Windows, process.name() may include the .exe suffix
        let match_found = target_names
            .iter()
            .any(|&target| name.eq_ignore_ascii_case(target));

        if match_found {
            println!(
                "Found process: {} (PID: {}) - terminating...",
                name,
                process.pid()
            );
            if process.kill() {
                killed += 1;
            } else {
                log_error(&format!("Could not terminate PID: {}", process.pid()));
            }
        }
    }

    if killed > 0 {
        log_success(&format!("Terminated {} process(es).", killed));
    } else {
        log_info("No running TauriTavern process was found.");
    }

    pause();
    Ok(())
}

fn check_port() -> Result<()> {
    let port = 1420;
    log_info(&format!("Checking port {} (frontend dev server)...", port));

    match TcpListener::bind(format!("127.0.0.1:{}", port)) {
        Ok(_listener) => {
            log_success(&format!("Port {} is free (not in use)", port));
            println!("  That means the dev server is not running right now.");
        }
        Err(_) => {
            log_warn(&format!("Port {} is already in use", port));
            println!("  That means the dev server is running, or another program holds the port.");
        }
    }

    pause();
    Ok(())
}

fn get_tool_version(tool: &str) -> String {
    match Command::new(get_cmd(tool)).arg("--version").output() {
        Ok(output) => {
            if output.status.success() {
                String::from_utf8_lossy(&output.stdout).trim().to_string()
            } else {
                "Unknown".to_string()
            }
        }
        Err(_) => "Not Found".to_string(),
    }
}

fn sys_info() -> Result<()> {
    log_info("Collecting system information...");
    let mut sys = System::new_all();
    sys.refresh_all();

    println!();
    println!("{}", "--- System Overview ---".cyan().bold());
    println!(
        "🖥️ OS:         {} {}",
        System::name().unwrap_or("Unknown".into()),
        System::os_version().unwrap_or("".into())
    );
    println!(
        "⚙️ Kernel:     {}",
        System::kernel_version().unwrap_or("Unknown".into())
    );
    println!(
        "🏠 Hostname:   {}",
        System::host_name().unwrap_or("Unknown".into())
    );

    let used_mem = sys.used_memory() as f64 / 1024.0 / 1024.0 / 1024.0;
    let total_mem = sys.total_memory() as f64 / 1024.0 / 1024.0 / 1024.0;
    println!("💾 Memory:     {:.2} GB / {:.2} GB", used_mem, total_mem);

    let cpus = sys.cpus();
    if !cpus.is_empty() {
        println!("🧠 CPU:        {} ({} cores)", cpus[0].brand(), cpus.len());
    }

    println!();
    println!("{}", "--- Development Environment ---".cyan().bold());
    println!("Node.js:    {}", get_tool_version("node"));
    println!("pnpm:       {}", get_tool_version("pnpm"));
    println!("Cargo:      {}", get_tool_version("cargo"));
    println!("Git:        {}", get_tool_version("git"));

    #[cfg(windows)]
    {
        println!();
        println!("{}", "--- WebView2 ---".cyan().bold());
        // Reuse the check_webview2 helper above, which prints its own result.
        // It returns Result<()>; a failed check is reported here so this summary
        // does not abort the whole system report.
        match check_webview2() {
            Ok(_) => {} // it prints "WebView2 Runtime is installed"
            Err(_) => println!("WebView2 Runtime was not detected, or the check failed"),
        }
    }

    println!();
    pause();
    Ok(())
}

fn run_debug() -> Result<()> {
    log_info("Starting debug mode (Debug Mode)...");
    log_info("Enabled: RUST_LOG=debug, RUST_BACKTRACE=1");

    // Set environment variables
    env::set_var("RUST_LOG", "debug");
    env::set_var("RUST_BACKTRACE", "1");
    // Force colors
    env::set_var("FORCE_COLOR", "1");
    env::set_var("CARGO_TERM_COLOR", "always");

    // Keep the same multi-candidate fallback strategy as run_sequential_attempts so a single
    // command answering NotFound does not fail the whole run.
    let candidates = [
        ("pnpm", vec!["tauri", "dev"]),
        ("pnpm", vec!["run", "tauri:dev"]),
        ("corepack", vec!["pnpm", "tauri", "dev"]),
        ("corepack", vec!["pnpm", "run", "tauri:dev"]),
        ("npm", vec!["run", "tauri:dev"]),
    ];

    let mut last_err: Option<anyhow::Error> = None;
    let mut child_opt = None;

    for (prog, args) in candidates.iter() {
        let cmd_prog = get_cmd(prog);
        log_info(&format!("Running command: {} {:?}", cmd_prog, args));

        match Command::new(&cmd_prog)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(child) => {
                child_opt = Some(child);
                break;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // On Windows, also try the command name without .cmd (for some shell and PATH setups).
                if cfg!(windows) && *prog != "corepack" {
                    match Command::new(prog)
                        .args(args)
                        .stdout(Stdio::piped())
                        .stderr(Stdio::piped())
                        .spawn()
                    {
                        Ok(child) => {
                            child_opt = Some(child);
                            break;
                        }
                        Err(e2) => {
                            last_err = Some(e2.into());
                        }
                    }
                } else {
                    last_err = Some(e.into());
                }
            }
            Err(e) => {
                last_err = Some(e.into());
            }
        }
    }

    let mut child = child_opt.ok_or_else(|| {
        anyhow::anyhow!("could not start the debug process")
            .context(last_err.unwrap_or_else(|| anyhow::anyhow!("program not found")))
    })?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    // Spawn threads to handle output
    let stdout_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            process_log_line(&line, false);
        }
    });

    let stderr_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            process_log_line(&line, true);
        }
    });

    // Wait for child
    let status = child.wait()?;

    stdout_handle.join().unwrap();
    stderr_handle.join().unwrap();

    if !status.success() {
        log_error("The debug process exited abnormally");
    }

    pause();
    Ok(())
}

fn process_log_line(line: &str, is_stderr: bool) {
    // Regex to strip ANSI codes for content analysis
    let re = Regex::new(r"\x1b\[[0-9;]*m").unwrap();
    let clean_line = re.replace_all(line, "");
    let upper = clean_line.to_uppercase();

    let timestamp = Local::now().format("%H:%M:%S").to_string();
    let prefix = format!("[{}]", timestamp).dimmed();

    // Check for errors/warnings
    if upper.contains("ERROR")
        || (is_stderr
            && !upper.contains("WARN")
            && !upper.contains("INFO")
            && !upper.contains("DEBUG"))
    {
        // Treat generic stderr as error unless it looks like other levels
        // Note: Some tools print normal info to stderr, so be careful.
        // If line contains "ERROR", definitely red.
        if upper.contains("ERROR") {
            println!("{} {} {}", prefix, "ERR".red().bold(), line);
        } else {
            // Maybe just yellow for unknown stderr? Or just print it.
            // Let's just print stderr as is but with prefix, unless it has specific keywords.
            println!("{} {}", prefix, line);
        }
    } else if upper.contains("WARN") {
        println!("{} {} {}", prefix, "WARN".yellow().bold(), line);
    } else if upper.contains("DEBUG") {
        println!("{} {} {}", prefix, "DEBUG".blue(), line);
    } else {
        println!("{} {}", prefix, line);
    }
}
