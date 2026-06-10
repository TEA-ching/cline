use clap::Parser;
use clinepool_download::{Args, ClinepoolError, main_logic, write_output};
use log::{debug, info};
use octocrab::Octocrab;
use std::fs;

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

    let octocrab = Octocrab::builder().build()?;
    main_logic(&args, octocrab).await
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
