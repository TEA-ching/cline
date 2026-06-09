use octocrab::{Octocrab, models::repos::Release};

use crate::ClinepoolError;

/// Finds the latest preview release from the given repository.
///
/// Queries the GitHub API for all releases, filters for those whose tag contains
/// "preview", then returns the most recently published one. When `version` is
/// provided, only releases whose tag starts with that version string are considered,
/// so that among several previews of the same version the newest is returned.
///
/// # Arguments
///
/// * `octocrab` - Authenticated Octocrab client
/// * `repo` - Repository in `"owner/repo"` format
/// * `version` - Optional version prefix (e.g., `"3.88.1"`)
///
/// # Examples
///
/// ```
/// let rt = tokio::runtime::Runtime::new().unwrap();
/// rt.block_on(async {
///     let client = octocrab::Octocrab::builder().build().unwrap();
///     // In real usage: find_latest_release(&client, "owner/repo", None).await
/// });
/// ```
pub async fn find_latest_release(
    octocrab: &Octocrab,
    repo: &str,
    version: Option<&str>,
) -> Result<Release, ClinepoolError> {
    let parts: Vec<&str> = repo.split('/').collect();
    if parts.len() != 2 {
        return Err(ClinepoolError::MissingArgument(format!(
            "Invalid repository format: {}",
            repo
        )));
    }

    let releases = octocrab
        .repos(parts[0], parts[1])
        .releases()
        .list()
        .send()
        .await?;

    let previews: Vec<Release> = releases
        .items
        .into_iter()
        .filter(|r| r.tag_name.contains("preview"))
        .collect();

    if previews.is_empty() {
        return Err(ClinepoolError::NoReleaseFound);
    }

    let candidates: Vec<Release> = match version {
        Some(v) => previews.into_iter().filter(|r| r.tag_name.contains(v)).collect(),
        None => previews,
    };

    if candidates.is_empty() {
        return Err(ClinepoolError::NoReleaseFound);
    }

    candidates
        .into_iter()
        .max_by(|a, b| a.published_at.cmp(&b.published_at))
        .ok_or(ClinepoolError::NoReleaseFound)
}
