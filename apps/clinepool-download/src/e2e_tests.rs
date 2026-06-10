use super::{Args, ClinepoolError, Platform};
use clap::Parser;
use octocrab::Octocrab;
use std::fs;
use tempfile;

/// Test end-to-end pour télécharger la CLI pour Darwin x64
#[tokio::test]
#[ignore = "Test réel, nécessite une connexion Internet"]
async fn test_download_cli_for_darwin_x64_e2e() {
    // Créer un client Octocrab pour interagir avec GitHub
    let octocrab = Octocrab::builder().build().unwrap();

    // Créer un répertoire temporaire pour le fichier de sortie
    let temp_dir = tempfile::tempdir().unwrap();
    let output_path = temp_dir.path().join("cline");

    let args = Args::parse_from([
        "test",
        "--repo", "TEA-ching/cline",
        "--cli",
        "--arch", "darwin-x64",
        "--out-file", output_path.to_str().unwrap(),
    ]);

    // Exécuter la logique principale
    let result = super::main_logic(&args, octocrab).await;

    // Vérifier que le téléchargement a réussi
    assert!(result.is_ok());
    assert!(output_path.exists());

    // Vérifier que le fichier téléchargé n'est pas vide
    let metadata = fs::metadata(&output_path).unwrap();
    assert!(metadata.len() > 0);
}

/// Test end-to-end pour télécharger le VSIX pour Win32 x64
#[tokio::test]
#[ignore = "Test réel, nécessite une connexion Internet"]
async fn test_download_vsix_for_win32_x64_e2e() {
    // Créer un client Octocrab pour interagir avec GitHub
    let octocrab = Octocrab::builder().build().unwrap();

    // Créer un répertoire temporaire pour le fichier de sortie
    let temp_dir = tempfile::tempdir().unwrap();
    let output_path = temp_dir.path().join("clinepool.vsix");

    let args = Args::parse_from([
        "test",
        "--repo", "TEA-ching/cline",
        "--vsix",
        "--arch", "win32-x64",
        "--out-file", output_path.to_str().unwrap(),
    ]);

    // Exécuter la logique principale
    let result = super::main_logic(&args, octocrab).await;

    // Vérifier que le téléchargement a réussi
    assert!(result.is_ok());
    assert!(output_path.exists());

    // Vérifier que le fichier téléchargé n'est pas vide
    let metadata = fs::metadata(&output_path).unwrap();
    assert!(metadata.len() > 0);
}

/// Test end-to-end pour télécharger la CLI pour Linux ARM64
#[tokio::test]
#[ignore = "Test réel, nécessite une connexion Internet"]
async fn test_download_cli_for_linux_arm64_e2e() {
    // Créer un client Octocrab pour interagir avec GitHub
    let octocrab = Octocrab::builder().build().unwrap();

    // Créer un répertoire temporaire pour le fichier de sortie
    let temp_dir = tempfile::tempdir().unwrap();
    let output_path = temp_dir.path().join("cline");

    let args = Args::parse_from([
        "test",
        "--repo", "TEA-ching/cline",
        "--cli",
        "--arch", "linux-arm64",
        "--out-file", output_path.to_str().unwrap(),
    ]);

    // Exécuter la logique principale
    let result = super::main_logic(&args, octocrab).await;

    // Vérifier que le téléchargement a réussi
    assert!(result.is_ok());
    assert!(output_path.exists());

    // Vérifier que le fichier téléchargé n'est pas vide
    let metadata = fs::metadata(&output_path).unwrap();
    assert!(metadata.len() > 0);
}

/// Test end-to-end pour télécharger le VSIX pour Linux x64
#[tokio::test]
#[ignore = "Test réel, nécessite une connexion Internet"]
async fn test_download_vsix_for_linux_x64_e2e() {
    // Créer un client Octocrab pour interagir avec GitHub
    let octocrab = Octocrab::builder().build().unwrap();

    // Créer un répertoire temporaire pour le fichier de sortie
    let temp_dir = tempfile::tempdir().unwrap();
    let output_path = temp_dir.path().join("clinepool.vsix");

    let args = Args::parse_from([
        "test",
        "--repo", "TEA-ching/cline",
        "--vsix",
        "--arch", "linux-x64",
        "--out-file", output_path.to_str().unwrap(),
    ]);

    // Exécuter la logique principale
    let result = super::main_logic(&args, octocrab).await;

    // Vérifier que le téléchargement a réussi
    assert!(result.is_ok());
    assert!(output_path.exists());

    // Vérifier que le fichier téléchargé n'est pas vide
    let metadata = fs::metadata(&output_path).unwrap();
    assert!(metadata.len() > 0);
}
