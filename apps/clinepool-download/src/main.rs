use clap::Parser;
use clinepool_download::{Args, ClinepoolError, main_logic};
use octocrab::Octocrab;
use log::debug;

#[tokio::main]
async fn main() -> Result<(), ClinepoolError> {
    rustls::crypto::ring::default_provider()
        .install_default()
        .ok();

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
    use clinepool_download::Args;
    use clap::Parser;

    #[test]
    fn test_write_output_stdout() {
        // Initialize rustls crypto provider for tests that may use octocrab/reqwest
        rustls::crypto::ring::default_provider()
            .install_default()
            .ok();
        let args = Args::parse_from(["test", "--cli", "--out-file", "-"]);
        // Writing empty content to stdout should not error
        assert!(clinepool_download::write_output(&args, b"").is_ok());
    }

    #[test]
    fn test_write_output_creates_parent_dirs() {
        let dir = std::env::temp_dir().join("clinepool_test_output");
        let path = dir.join("nested").join("test.vsix");
        let args = Args::parse_from([
            "test", "--vsix", "--out-file",
            path.to_str().unwrap(),
        ]);
        assert!(clinepool_download::write_output(&args, b"test").is_ok());
        assert!(path.exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_write_output_default_vsix_name() {
        let args = Args::parse_from(["test", "--vsix"]);
        // Only check it doesn't error (file lands in cwd)
        assert!(clinepool_download::write_output(&args, b"").is_ok());
        std::fs::remove_file("clinepool.vsix").ok();
    }

    #[test]
    fn test_write_output_default_cli_name() {
        let args = Args::parse_from(["test", "--cli"]);
        assert!(clinepool_download::write_output(&args, b"").is_ok());
        std::fs::remove_file("cline").ok();
    }

    #[test]
    fn test_find_existing_file_not_found() {
        let result = clinepool_download::find_existing_file("nonexistent-file");
        assert!(matches!(result, Err(clinepool_download::ClinepoolError::FileNotFound(_))));
    }

    #[test]
    fn test_find_existing_file_in_current_dir() {
        // Create a test file
        let test_file = "test-cline-executable";
        std::fs::write(test_file, "test content").unwrap();

        // Make it executable on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let metadata = std::fs::metadata(test_file).unwrap();
            let mut permissions = metadata.permissions();
            permissions.set_mode(permissions.mode() | 0o111);
            std::fs::set_permissions(test_file, permissions).unwrap();
        }

        // Test finding the file
        let result = clinepool_download::find_existing_file(test_file);
        assert!(result.is_ok());
        let found_path = result.unwrap();
        assert!(found_path.ends_with(test_file));

        // Clean up
        std::fs::remove_file(test_file).ok();
    }

    #[test]
    fn test_replace_existing_file_preserves_permissions() {
        // Create a test file with executable permissions
        let test_file = "test-replace-file";
        let original_content = b"original content";
        std::fs::write(test_file, original_content).unwrap();

        // Make it executable on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let metadata = std::fs::metadata(test_file).unwrap();
            let mut permissions = metadata.permissions();
            permissions.set_mode(permissions.mode() | 0o111);
            std::fs::set_permissions(test_file, permissions).unwrap();
        }

        // Check if it was executable
        #[cfg(unix)]
        let was_executable = {
            use std::os::unix::fs::PermissionsExt;
            let metadata = std::fs::metadata(test_file).unwrap();
            metadata.permissions().mode() & 0o111 != 0
        };

        // Replace the file
        let new_content = b"new content";
        let result = clinepool_download::replace_existing_file(std::path::Path::new(test_file), new_content);
        assert!(result.is_ok());

        // Verify content was replaced
        let replaced_content = std::fs::read(test_file).unwrap();
        assert_eq!(replaced_content, new_content);

        // Verify permissions were preserved on Unix
        #[cfg(unix)]
        if was_executable {
            use std::os::unix::fs::PermissionsExt;
            let metadata = std::fs::metadata(test_file).unwrap();
            assert_ne!(metadata.permissions().mode() & 0o111, 0, "Executable permissions should be preserved");
        }

        // Clean up
        std::fs::remove_file(test_file).ok();
    }

    #[test]
    fn test_update_flag_parsing() {
        let args = Args::parse_from(["test", "--cli", "--update"]);
        assert!(args.update);
        assert!(args.cli);
        assert!(!args.vsix);

        let args = Args::parse_from(["test", "--vsix", "--update"]);
        assert!(args.update);
        assert!(args.vsix);
        assert!(!args.cli);
    }
}
