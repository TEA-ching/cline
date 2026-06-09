use clap::Parser;
use clinepool_download::{Args, ClinepoolError, detect_platform};
use clinepool_download::github::find_latest_release;
use log::{debug, info};
use octocrab::Octocrab;
use std::fs;
use std::io::{self, Write};
use std::path::Path;

#[tokio::main]
async fn main() -> Result<(), ClinepoolError> {
    let args = Args::parse();

    // Set up logging based on command line arguments
    let log_level = if args.debug {
        log::LevelFilter::Debug
    } else if args.verbose > 0 {
        log::LevelFilter::Info
    } else {
        // Default: no logging
        log::LevelFilter::Off
    };

    env_logger::Builder::new()
        .filter_level(log_level)
        .parse_env("RUST_LOG")
        .init();

    debug!("Parsed arguments: {:?}", args);

    if !args.cli && !args.vsix {
        return Err(ClinepoolError::MissingArgument(
            "Either --cli or --vsix must be specified".to_string(),
        ));
    }

    let platform = match args.arch {
        Some(ref arch) => {
            clinepool_download::Platform::from_str(arch)
                .ok_or_else(|| ClinepoolError::InvalidPlatform(arch.clone()))?
        }
        None => detect_platform()?,
    };

    info!("Platform: {}", platform.as_str());

    let octocrab = Octocrab::builder().build()?;

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
        .await?;

    write_output(&args, &content)?;

    Ok(())
}

fn write_output(args: &Args, content: &[u8]) -> Result<(), ClinepoolError> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use clinepool_download::Args;
    use clap::Parser;

    #[test]
    fn test_write_output_stdout() {
        let args = Args::parse_from(["test", "--cli", "--out-file", "-"]);
        // Writing empty content to stdout should not error
        assert!(write_output(&args, b"").is_ok());
    }

    #[test]
    fn test_write_output_creates_parent_dirs() {
        let dir = std::env::temp_dir().join("clinepool_test_output");
        let path = dir.join("nested").join("test.vsix");
        let args = Args::parse_from([
            "test", "--vsix", "--out-file",
            path.to_str().unwrap(),
        ]);
        assert!(write_output(&args, b"test").is_ok());
        assert!(path.exists());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_write_output_default_vsix_name() {
        let args = Args::parse_from(["test", "--vsix"]);
        // Only check it doesn't error (file lands in cwd)
        assert!(write_output(&args, b"").is_ok());
        fs::remove_file("clinepool.vsix").ok();
    }

    #[test]
    fn test_write_output_default_cli_name() {
        let args = Args::parse_from(["test", "--cli"]);
        assert!(write_output(&args, b"").is_ok());
        fs::remove_file("cline").ok();
    }
}
