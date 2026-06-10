pub mod github;

use log::{debug, info};
use octocrab::Octocrab;
use std::fs;
use std::io::{self, Write};
use std::path::Path;
use crate::github::find_latest_release;

/// Supported platforms for Clinepool release assets
#[derive(Debug, Clone, clap::ValueEnum, PartialEq, Eq)]
pub enum Platform {
    DarwinX64,
    DarwinArm64,
    LinuxX64,
    LinuxArm64,
    LinuxArmhf,
    AlpineX64,
    Win32X64,
    Win32Arm64,
}

impl Platform {
    /// Returns the identifier string used in release asset names.
    ///
    /// ```
    /// use clinepool_download::Platform;
    /// assert_eq!(Platform::DarwinX64.as_str(), "darwin-x64");
    /// assert_eq!(Platform::Win32X64.as_str(), "win32-x64");
    /// ```
    pub fn as_str(&self) -> &'static str {
        match self {
            Platform::DarwinX64 => "darwin-x64",
            Platform::DarwinArm64 => "darwin-arm64",
            Platform::LinuxX64 => "linux-x64",
            Platform::LinuxArm64 => "linux-arm64",
            Platform::LinuxArmhf => "linux-armhf",
            Platform::AlpineX64 => "alpine-x64",
            Platform::Win32X64 => "win32-x64",
            Platform::Win32Arm64 => "win32-arm64",
        }
    }

    /// Parses a platform identifier string.
    ///
    /// ```
    /// use clinepool_download::Platform;
    /// assert_eq!(Platform::from_str("darwin-x64"), Some(Platform::DarwinX64));
    /// assert_eq!(Platform::from_str("invalid"), None);
    /// ```
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "darwin-x64" => Some(Platform::DarwinX64),
            "darwin-arm64" => Some(Platform::DarwinArm64),
            "linux-x64" => Some(Platform::LinuxX64),
            "linux-arm64" => Some(Platform::LinuxArm64),
            "linux-armhf" => Some(Platform::LinuxArmhf),
            "alpine-x64" => Some(Platform::AlpineX64),
            "win32-x64" => Some(Platform::Win32X64),
            "win32-arm64" => Some(Platform::Win32Arm64),
            _ => None,
        }
    }
}

/// Custom error type for clinepool-download
#[derive(thiserror::Error, Debug)]
pub enum ClinepoolError {
    #[error("GitHub API error: {0}")]
    GitHubError(#[from] octocrab::Error),
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Download error: {0}")]
    DownloadError(#[from] reqwest::Error),
    #[error("Invalid platform: {0}")]
    InvalidPlatform(String),
    #[error("No matching release found")]
    NoReleaseFound,
    #[error("Missing required argument: {0}")]
    MissingArgument(String),
}

/// Writes the downloaded content to the specified output file or stdout.
pub fn write_output(args: &Args, content: &[u8]) -> Result<(), ClinepoolError> {
    if args.out_file == "-" {
        io::stdout().write_all(content)?;
        return Ok(());
    }

    let output_path = if args.out_file.is_empty() {
        if args.cli {
            Path::new("cline").to_path_buf()
        } else {
            Path::new("clinepool.vsix").to_path_buf()
        }
    } else {
        Path::new(&args.out_file).to_path_buf()
    };

    if let Some(parent) = output_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }

    fs::write(&output_path, content)?;

    // On Unix-like platforms, set executable permission for CLI files
    #[cfg(unix)]
    if args.cli {
        use std::os::unix::fs::PermissionsExt;
        let metadata = fs::metadata(&output_path)?;
        let mut permissions = metadata.permissions();
        permissions.set_mode(permissions.mode() | 0o111); // Add executable bits
        fs::set_permissions(&output_path, permissions)?;
        info!("Set executable permissions on: {}", output_path.display());
    }

    info!("Saved to: {}", output_path.display());
    Ok(())
}

// disable_version_flag prevents clap from auto-generating --version, which
// would conflict with the --version flag for specifying a release version.
#[derive(clap::Parser, Debug)]
#[command(author, about, long_about = None, disable_version_flag = true)]
pub struct Args {
    /// GitHub repository in format owner/repo
    #[arg(long, default_value = "TEA-ching/cline")]
    pub repo: String,
    /// Clinepool release version to download (e.g., 3.88.1)
    #[arg(long)]
    pub version: Option<String>,
    /// Target platform (e.g., win32-x64, darwin-arm64)
    #[arg(long)]
    pub arch: Option<String>,
    /// Download the CLI binary
    #[arg(long, conflicts_with = "vsix")]
    pub cli: bool,
    /// Download the VSIX extension
    #[arg(long, conflicts_with = "cli")]
    pub vsix: bool,
    /// Output file path; use '-' to write to stdout
    #[arg(long, default_value = "")]
    pub out_file: String,
    /// Enable verbose logging
    #[arg(short, long, action = clap::ArgAction::Count)]
    pub verbose: u8,
    /// Enable debug logging
    #[arg(long)]
    pub debug: bool,
}

/// Detects the current platform from OS and architecture constants.
///
/// ```
/// use clinepool_download::detect_platform;
/// let platform = detect_platform().unwrap();
/// println!("{}", platform.as_str());
/// ```
pub fn detect_platform() -> Result<Platform, ClinepoolError> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "x86_64") => Ok(Platform::DarwinX64),
        ("macos", "aarch64") => Ok(Platform::DarwinArm64),
        ("linux", "x86_64") => Ok(Platform::LinuxX64),
        ("linux", "aarch64") => Ok(Platform::LinuxArm64),
        ("linux", "arm") => Ok(Platform::LinuxArmhf),
        ("windows", "x86_64") => Ok(Platform::Win32X64),
        ("windows", "aarch64") => Ok(Platform::Win32Arm64),
        (os, arch) => Err(ClinepoolError::InvalidPlatform(format!("{}-{}", os, arch))),
    }
}

/// Executes the main logic of the application.
pub async fn main_logic(args: &Args, octocrab: Octocrab) -> Result<(), ClinepoolError> {
    if !args.cli && !args.vsix {
        return Err(ClinepoolError::MissingArgument(
            "Either --cli or --vsix must be specified".to_string(),
        ));
    }

    let platform = match args.arch.as_ref() {
        Some(arch) => {
            Platform::from_str(arch)
                .ok_or_else(|| ClinepoolError::InvalidPlatform(arch.clone()))?
        }
        None => detect_platform()?,
    };

    info!("Platform: {}", platform.as_str());

    let release = find_latest_release(&octocrab, &args.repo, args.version.as_deref()).await?;

    let platform_str = platform.as_str();
    let asset = if args.cli {
        release.assets.iter().find(|a| {
            a.name.starts_with("clinepool-cli-")
                && a.name.ends_with(&format!("-{}", platform_str))
        })
    } else {
        release.assets.iter().find(|a| {
            a.name.starts_with("clinepool-")
                && !a.name.starts_with("clinepool-cli-")
                && a.name.ends_with(&format!("-{}.vsix", platform_str))
        })
    }
    .ok_or(ClinepoolError::NoReleaseFound)?;

    info!("Found asset: {}", asset.name);

    info!("Downloading: {} ({} bytes)", asset.name, asset.size);

    let content = reqwest::get(asset.browser_download_url.as_str())
        .await?
        .bytes()
        .await?
        .to_vec();

    write_output(args, &content)?;

    Ok(())
}

#[cfg(test)]
mod github_tests;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod e2e_tests;

