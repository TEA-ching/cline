pub mod github;

use log::{info};
use octocrab::Octocrab;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::env;
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
    #[error("File not found: {0}")]
    FileNotFound(String),
    #[error("Failed to resolve file path: {0}")]
    PathResolutionError(String),
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
    /// Update existing installation by replacing the current file
    #[arg(long)]
    pub update: bool,
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

/// Finds the path to an existing file in the current directory or PATH
/// Returns the resolved path if found, or an error if not found
pub fn find_existing_file(target_name: &str) -> Result<PathBuf, ClinepoolError> {
    // First, check current directory
    let current_dir_path = Path::new(".").join(target_name);
    if current_dir_path.exists() {
        // Resolve symlinks to get the actual file
        let resolved_path = fs::canonicalize(&current_dir_path)
            .map_err(|e| ClinepoolError::PathResolutionError(e.to_string()))?;
        info!("Found file in current directory: {}", resolved_path.display());
        return Ok(resolved_path);
    }

    // Then, check PATH environment variable
    if let Some(path_env) = env::var_os("PATH") {
        for path in env::split_paths(&path_env) {
            let candidate_path = path.join(target_name);
            if candidate_path.exists() {
                // Resolve symlinks to get the actual file
                let resolved_path = fs::canonicalize(&candidate_path)
                    .map_err(|e| ClinepoolError::PathResolutionError(e.to_string()))?;
                info!("Found file in PATH: {}", resolved_path.display());
                return Ok(resolved_path);
            }
        }
    }

    Err(ClinepoolError::FileNotFound(format!(
        "Could not find '{}' in current directory or PATH",
        target_name
    )))
}

/// Replaces an existing file with new content
/// Preserves executable permissions if the original file had them
pub fn replace_existing_file(existing_path: &Path, new_content: &[u8]) -> Result<(), ClinepoolError> {
    // Check if original file is executable (Unix only)
    #[cfg(unix)]
    let was_executable = {
        use std::os::unix::fs::PermissionsExt;
        let metadata = fs::metadata(existing_path)?;
        metadata.permissions().mode() & 0o111 != 0
    };

    // Write new content
    fs::write(existing_path, new_content)?;

    // Restore executable permissions if needed
    #[cfg(unix)]
    if was_executable {
        use std::os::unix::fs::PermissionsExt;
        let metadata = fs::metadata(existing_path)?;
        let mut permissions = metadata.permissions();
        permissions.set_mode(permissions.mode() | 0o111); // Add executable bits
        fs::set_permissions(existing_path, permissions)?;
        info!("Restored executable permissions on: {}", existing_path.display());
    }

    info!("Replaced file: {}", existing_path.display());
    Ok(())
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

    if args.update {
        // Update mode: find and replace existing file
        let target_name = if args.cli { "cline" } else { "clinepool.vsix" };
        let existing_path = find_existing_file(target_name)?;

        // Check if we're trying to update a file but output is specified to stdout
        if args.out_file == "-" {
            return Err(ClinepoolError::MissingArgument(
                "Cannot use --update with stdout output (--out-file -)".to_string(),
            ));
        }

        // If out_file is specified, use it as the target for replacement
        let target_path = if args.out_file.is_empty() {
            existing_path
        } else {
            PathBuf::from(&args.out_file)
        };

        replace_existing_file(&target_path, &content)?;
    } else {
        // Normal mode: write to specified output
        write_output(args, &content)?;
    }

    Ok(())
}

#[cfg(test)]
mod github_tests;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod e2e_tests;

