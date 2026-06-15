use mockito::{Matcher, Server};
use octocrab::Octocrab;
use serde_json::json;

use crate::{ClinepoolError, github::find_latest_release};

const RELEASES_PATH: &str = r"^/repos/TEA-ching/cline/releases";

/// Builds a complete GitHub release JSON object accepted by octocrab's deserializer.
fn make_release(tag: &str, published_at: &str) -> serde_json::Value {
    json!({
        "url": "https://api.github.com/repos/test/test/releases/1",
        "html_url": "https://github.com/test/test/releases/tag/v1",
        "assets_url": "https://api.github.com/repos/test/test/releases/1/assets",
        "upload_url": "https://uploads.github.com/repos/test/test/releases/1/assets{?name,label}",
        "tarball_url": null,
        "zipball_url": null,
        "id": 1,
        "node_id": "test",
        "tag_name": tag,
        "target_commitish": "main",
        "name": null,
        "body": null,
        "draft": false,
        "prerelease": true,
        "created_at": published_at,
        "published_at": published_at,
        "author": {
            "login": "test", "id": 1, "node_id": "test",
            "avatar_url": "https://avatars.githubusercontent.com/u/1",
            "gravatar_id": "", "url": "https://api.github.com/users/test",
            "html_url": "https://github.com/test",
            "followers_url": "https://api.github.com/users/test/followers",
            "following_url": "https://api.github.com/users/test/following{/other_user}",
            "gists_url": "https://api.github.com/users/test/gists{/gist_id}",
            "starred_url": "https://api.github.com/users/test/starred{/owner}{/repo}",
            "subscriptions_url": "https://api.github.com/users/test/subscriptions",
            "organizations_url": "https://api.github.com/users/test/orgs",
            "repos_url": "https://api.github.com/users/test/repos",
            "events_url": "https://api.github.com/users/test/events{/privacy}",
            "received_events_url": "https://api.github.com/users/test/received_events",
            "type": "User", "site_admin": false
        },
        "assets": []
    })
}

#[tokio::test]
async fn test_find_latest_preview_release() {
    rustls::crypto::ring::default_provider()
        .install_default()
        .ok();
    let mut server = Server::new_async().await;
    let body = json!([
        make_release("preview/2026-06-09T13-43-44Z", "2026-06-09T13:43:44Z"),
        make_release("preview/2026-06-08T12-32-22Z", "2026-06-08T12:32:22Z"),
    ])
    .to_string();

    let mock = server
        .mock("GET", Matcher::Regex(RELEASES_PATH.to_string()))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(body)
        .create_async()
        .await;

    let octocrab = Octocrab::builder()
        .base_uri(server.url())
        .unwrap()
        .build()
        .unwrap();

    let release = find_latest_release(&octocrab, "TEA-ching/cline", None)
        .await
        .unwrap();

    assert_eq!(release.tag_name, "preview/2026-06-09T13-43-44Z");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_find_latest_of_specific_version() {
    rustls::crypto::ring::default_provider()
        .install_default()
        .ok();
    let mut server = Server::new_async().await;
    let body = json!([
        make_release("preview/2026-06-09T13-43-44Z", "2026-06-09T13:43:44Z"),
        make_release("preview/2026-06-09T12-32-22Z", "2026-06-09T12:32:22Z"),
        make_release("preview/2026-06-07T11-21-10Z", "2026-06-07T11:21:10Z"),
    ])
    .to_string();

    let mock = server
        .mock("GET", Matcher::Regex(RELEASES_PATH.to_string()))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(body)
        .create_async()
        .await;

    let octocrab = Octocrab::builder()
        .base_uri(server.url())
        .unwrap()
        .build()
        .unwrap();

    // Filter by date substring to select among multiple same-day previews
    let release = find_latest_release(&octocrab, "TEA-ching/cline", Some("2026-06-09"))
        .await
        .unwrap();

    assert_eq!(release.tag_name, "preview/2026-06-09T13-43-44Z");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_no_preview_releases_returns_error() {
    rustls::crypto::ring::default_provider()
        .install_default()
        .ok();
    let mut server = Server::new_async().await;
    let body = json!([
        make_release("stable/2026-06-09T13-43-44Z", "2026-06-09T13:43:44Z"),
    ])
    .to_string();

    let mock = server
        .mock("GET", Matcher::Regex(RELEASES_PATH.to_string()))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(body)
        .create_async()
        .await;

    let octocrab = Octocrab::builder()
        .base_uri(server.url())
        .unwrap()
        .build()
        .unwrap();

    let result = find_latest_release(&octocrab, "TEA-ching/cline", None).await;
    assert!(matches!(result, Err(ClinepoolError::NoReleaseFound)));
    mock.assert_async().await;
}

#[tokio::test]
async fn test_requested_version_not_found_returns_error() {
    rustls::crypto::ring::default_provider()
        .install_default()
        .ok();
    let mut server = Server::new_async().await;
    let body = json!([
        make_release("preview/2026-06-09T13-43-44Z", "2026-06-09T13:43:44Z"),
    ])
    .to_string();

    let mock = server
        .mock("GET", Matcher::Regex(RELEASES_PATH.to_string()))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(body)
        .create_async()
        .await;

    let octocrab = Octocrab::builder()
        .base_uri(server.url())
        .unwrap()
        .build()
        .unwrap();

    let result = find_latest_release(&octocrab, "TEA-ching/cline", Some("2026-06-11")).await;
    assert!(matches!(result, Err(ClinepoolError::NoReleaseFound)));
    mock.assert_async().await;
}
