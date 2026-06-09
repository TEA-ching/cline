pub mod github;

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

#[cfg(test)]
mod github_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[test]
    fn test_platform_conversions() {
        let pairs = [
            (Platform::DarwinX64, "darwin-x64"),
            (Platform::DarwinArm64, "darwin-arm64"),
            (Platform::LinuxX64, "linux-x64"),
            (Platform::LinuxArm64, "linux-arm64"),
            (Platform::LinuxArmhf, "linux-armhf"),
            (Platform::AlpineX64, "alpine-x64"),
            (Platform::Win32X64, "win32-x64"),
            (Platform::Win32Arm64, "win32-arm64"),
        ];
        for (variant, s) in pairs {
            assert_eq!(variant.as_str(), s);
            assert_eq!(Platform::from_str(s).unwrap().as_str(), s);
        }
        assert_eq!(Platform::from_str("invalid"), None);
        assert_eq!(Platform::from_str(""), None);
    }

    #[test]
    fn test_detect_platform_succeeds() {
        assert!(detect_platform().is_ok());
    }

    #[test]
    fn test_args_defaults() {
        let args = Args::parse_from(["test"]);
        assert_eq!(args.repo, "TEA-ching/cline");
        assert!(args.version.is_none() && args.arch.is_none());
        assert!(!args.cli && !args.vsix);
        assert_eq!(args.out_file, "");
        assert_eq!(args.verbose, 0);
    }

    #[test]
    fn test_args_all_flags() {
        let args = Args::parse_from([
            "test", "--repo", "org/repo", "--version", "3.88.1",
            "--arch", "win32-x64", "--cli", "--out-file", "./out", "-v",
        ]);
        assert_eq!(args.repo, "org/repo");
        assert_eq!(args.version, Some("3.88.1".to_string()));
        assert_eq!(args.arch, Some("win32-x64".to_string()));
        assert!(args.cli && !args.vsix);
        assert_eq!(args.out_file, "./out");
        assert_eq!(args.verbose, 1);
        assert!(!args.debug);
    }

    #[test]
    fn test_args_debug_flag() {
        let args = Args::parse_from([
            "test", "--debug"
        ]);
        assert!(args.debug);
    }

    #[test]
    fn test_args_vsix_and_mutual_exclusion() {
        assert!(Args::parse_from(["test", "--vsix"]).vsix);
        assert!(Args::try_parse_from(["test", "--cli", "--vsix"]).is_err());
    }

    #[test]
    fn test_error_display_messages() {
        assert_eq!(ClinepoolError::InvalidPlatform("bad".to_string()).to_string(), "Invalid platform: bad");
        assert_eq!(ClinepoolError::NoReleaseFound.to_string(), "No matching release found");
        assert_eq!(ClinepoolError::MissingArgument("x".to_string()).to_string(), "Missing required argument: x");
    }
}
