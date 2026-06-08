import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, Typography, Spinner } from '@heroui/react'
import { Octokit } from '@octokit/rest'

/**
 * Download section component for the ClinePool website
 * Handles fetching and displaying downloadable assets from GitHub releases
 */
export default function DownloadSection() {
  const { t } = useTranslation('common')
  const [releases, setReleases] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAllPlatforms, setShowAllPlatforms] = useState(false)
  const [showAllVersions, setShowAllVersions] = useState(false)

  // Get user's platform
  const getUserPlatform = () => {
    const { userAgent } = navigator
    if (userAgent.includes('Mac')) return 'darwin'
    if (userAgent.includes('Win')) return 'windows'
    if (userAgent.includes('Linux')) return 'linux'
    return 'windows' // default
  }

  // Get user's architecture
  const getUserArchitecture = () => {
    if (navigator.userAgent.includes('x64') || navigator.userAgent.includes('Win64')) {
      return 'x64'
    }
    if (navigator.userAgent.includes('arm64') || navigator.userAgent.includes('aarch64')) {
      return 'arm64'
    }
    return 'x64' // default
  }

  // Fetch releases from GitHub
  const fetchReleases = async () => {
    try {
      setLoading(true)
      setError(null)

      const octokit = new Octokit()
      const response = await octokit.rest.repos.listReleases({
        owner: 'TEA-ching',
        repo: 'cline',
      })

      // Filter for preview releases created by the keypool-live-preview workflow
      const previewReleases = response.data.filter((release: any) =>
        release.prerelease &&
        release.tag_name.startsWith('preview/')
      )

      // Sort by published_at date (newest first)
      previewReleases.sort((a: any, b: any) =>
        new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
      )

      setReleases(previewReleases)
    } catch (err) {
      console.error('Error fetching releases:', err)
      setError('Failed to fetch releases. Please try again later.')
    } finally {
      setLoading(false)
    }
  }

  // Fetch releases on component mount
  useEffect(() => {
    fetchReleases()
  }, [])

  // Get platform-specific assets
  const getPlatformAssets = (release: any) => {
    const userPlatform = getUserPlatform()
    const userArch = getUserArchitecture()

    // Filter assets for the user's platform and architecture
    const platformAssets = release.assets.filter((asset: any) => {
      if (asset.name.includes('clinepool-cli')) {
        return asset.name.includes(userPlatform) && asset.name.includes(userArch)
      }
      if (asset.name.includes('clinepool-') && asset.name.endsWith('.vsix')) {
        return asset.name.includes(userPlatform) && asset.name.includes(userArch)
      }
      return false
    })

    return platformAssets
  }

  // Get all platform assets
  const getAllPlatformAssets = (release: any) => {
    return release.assets.filter((asset: any) =>
      asset.name.includes('clinepool-cli') || (asset.name.includes('clinepool-') && asset.name.endsWith('.vsix'))
    )
  }

  // Format date
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  return (
        <section id="downloads" className="py-20 md:py-28 lg:py-32">
      <div className="container">
        {/* Section header */}
        <div className="mx-auto mb-16 max-w-3xl text-center">
          <Typography type="h2" className="mb-4">
            {t('download.title')}
          </Typography>
          <Typography type="body" color="muted" className="max-w-2xl mx-auto">
            {t('download.subtitle')}
          </Typography>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Typography type="body" className="mb-4 text-danger">
              {error}
            </Typography>
            <Button onClick={fetchReleases} variant="secondary">
              Retry
            </Button>
          </div>
        )}

        {/* Releases */}
        {!loading && !error && releases.length > 0 && (
          <div className="space-y-8">
            {/* Show toggle for older versions if there are multiple releases */}
            {releases.length > 1 && (
              <div className="flex justify-end mb-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAllVersions(!showAllVersions)}
                >
                  {showAllVersions ? t('download.hideOlderVersions') : t('download.showOlderVersions')}
                </Button>
              </div>
            )}

            {/* Show either just the latest release or all releases */}
            {(showAllVersions ? releases : [releases[0]]).map((release) => {
              const platformAssets = getPlatformAssets(release)
              const allPlatformAssets = getAllPlatformAssets(release)

              return (
                <Card key={release.id} className="p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <Typography type="h4" className="mb-1">
                        {t('download.version', { version: release.tag_name })}
                      </Typography>
                      <Typography type="body-sm" color="muted">
                        {t('download.lastUpdated', { date: formatDate(release.published_at) })}
                      </Typography>
                    </div>
                    <div className="rounded-md border border-accent px-2 py-0.5 text-xs text-accent">
                      Preview
                    </div>
                  </div>

                  {/* VSIX Download */}
                  <div className="mb-6">
                    <Typography type="h5" className="mb-3">
                      {t('download.vsixTitle')}
                    </Typography>
                    <div className="space-y-2">
                      {platformAssets
                        .filter((asset: any) => asset.name.endsWith('.vsix'))
                        .map((asset: any) => (
                          <div key={asset.id} className="flex items-center justify-between rounded-lg border p-3">
                            <div>
                              <Typography type="body" className="font-medium">
                                {asset.name}
                              </Typography>
                              <Typography type="body-sm" color="muted">
                                {(asset.size / (1024 * 1024)).toFixed(2)} MB
                              </Typography>
                            </div>
                            <a
                              href={asset.browser_download_url}
                              download
                              className="inline-block"
                            >
                              <Button size="sm" variant="secondary">
                                Download
                              </Button>
                            </a>
                          </div>
                        ))}

                      {/* Show all platforms button for VSIX */}
                      {allPlatformAssets.filter((asset: any) => asset.name.endsWith('.vsix')).length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2"
                          onClick={() => setShowAllPlatforms(!showAllPlatforms)}
                        >
                          {showAllPlatforms ? t('download.hidePlatforms') : t('download.showAllPlatforms')}
                        </Button>
                      )}

                      {/* All platforms VSIX */}
                      {showAllPlatforms && allPlatformAssets
                        .filter((asset: any) => asset.name.endsWith('.vsix'))
                        .map((asset: any) => (
                          <div key={asset.id} className="flex items-center justify-between rounded-lg border p-3">
                            <div>
                              <Typography type="body" className="font-medium">
                                {asset.name}
                              </Typography>
                              <Typography type="body-sm" color="muted">
                                {(asset.size / (1024 * 1024)).toFixed(2)} MB
                              </Typography>
                            </div>
                            <a
                              href={asset.browser_download_url}
                              download
                              className="inline-block"
                            >
                              <Button size="sm" variant="secondary">
                                Download
                              </Button>
                            </a>
                          </div>
                        ))}
                    </div>
                  </div>

                  {/* CLI Download */}
                  <div>
                    <Typography type="h5" className="mb-3">
                      {t('download.cliTitle')}
                    </Typography>
                    <div className="space-y-2">
                      {platformAssets
                        .filter((asset: any) => asset.name.includes('clinepool-cli'))
                        .map((asset: any) => (
                          <div key={asset.id} className="flex items-center justify-between rounded-lg border p-3">
                            <div>
                              <Typography type="body" className="font-medium">
                                {asset.name}
                              </Typography>
                              <Typography type="body-sm" color="muted">
                                {(asset.size / (1024 * 1024)).toFixed(2)} MB
                              </Typography>
                            </div>
                            <a
                              href={asset.browser_download_url}
                              download
                              className="inline-block"
                            >
                              <Button size="sm" variant="secondary">
                                Download
                              </Button>
                            </a>
                          </div>
                        ))}

                      {/* Show all platforms button for CLI */}
                      {allPlatformAssets.filter((asset: any) => asset.name.includes('clinepool-cli')).length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2"
                          onClick={() => setShowAllPlatforms(!showAllPlatforms)}
                        >
                          {showAllPlatforms ? t('download.hidePlatforms') : t('download.showAllPlatforms')}
                        </Button>
                      )}

                      {/* All platforms CLI */}
                      {showAllPlatforms && allPlatformAssets
                        .filter((asset: any) => asset.name.includes('clinepool-cli'))
                        .map((asset: any) => (
                          <div key={asset.id} className="flex items-center justify-between rounded-lg border p-3">
                            <div>
                              <Typography type="body" className="font-medium">
                                {asset.name}
                              </Typography>
                              <Typography type="body-sm" color="muted">
                                {(asset.size / (1024 * 1024)).toFixed(2)} MB
                              </Typography>
                            </div>
                            <a
                              href={asset.browser_download_url}
                              download
                              className="inline-block"
                            >
                              <Button size="sm" variant="secondary">
                                Download
                              </Button>
                            </a>
                          </div>
                        ))}
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
