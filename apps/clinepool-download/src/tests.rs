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
