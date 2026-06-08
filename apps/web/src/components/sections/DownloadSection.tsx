import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, Typography, Spinner, Pagination } from '@heroui/react'
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
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalReleases, setTotalReleases] = useState(0)

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
  const fetchReleases = async (page = 1, perPage = 10) => {
    try {
      setLoading(true)
      setError(null)

      const octokit = new Octokit()
      const response = await octokit.rest.repos.listReleases({
        owner: 'TEA-ching',
        repo: 'cline',
        per_page: perPage,
        page: page
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

      // Store all releases but only show the latest one initially
      setReleases(previewReleases)
      setTotalReleases(previewReleases.length)
      setTotalPages(Math.ceil(previewReleases.length / perPage))
      setCurrentPage(1)
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

  // No need to fetch on page change - we already have all releases
  // We just need to update the current page state
  useEffect(() => {
    // This effect is just to track page changes
  }, [currentPage])

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
            <Button onPress={() => fetchReleases()} variant="secondary">
              Retry
            </Button>
          </div>
        )}

        {/* Releases */}
        {!loading && !error && releases.length > 0 && (
          <div className="space-y-8">
            {/* Show toggle for older versions if there are multiple releases */}
            {releases.length > 1 && (
              <div className="flex justify-between items-center mb-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => setShowAllVersions(!showAllVersions)}
                >
                  {showAllVersions ? t('download.hideOlderVersions') : t('download.showOlderVersions')}
                </Button>

                {/* Pagination controls when showing all versions */}
                {showAllVersions && totalPages > 1 && (
                  <Pagination className="justify-end">
                    <Pagination.Content>
                      <Pagination.Item>
                        <Pagination.Previous
                          isDisabled={currentPage === 1}
                          onPress={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        >
                          <Pagination.PreviousIcon />
                          <span>Previous</span>
                        </Pagination.Previous>
                      </Pagination.Item>

                      {(() => {
                        const pages: (number | "ellipsis")[] = [];

                        // Always show first page
                        pages.push(1);

                        // Show ellipsis if current page is more than 2 pages away from the start
                        if (currentPage > 3) {
                          pages.push("ellipsis");
                        }

                        // Show pages around current page
                        const start = Math.max(2, currentPage - 1);
                        const end = Math.min(totalPages - 1, currentPage + 1);

                        for (let i = start; i <= end; i++) {
                          pages.push(i);
                        }

                        // Show ellipsis if current page is more than 2 pages away from the end
                        if (currentPage < totalPages - 2) {
                          pages.push("ellipsis");
                        }

                        // Always show last page if different from first
                        if (totalPages > 1) {
                          pages.push(totalPages);
                        }

                        // Remove duplicates
                        const uniquePages = Array.from(new Set(pages));

                        return uniquePages.map((p, i) =>
                          p === "ellipsis" ? (
                            <Pagination.Item key={`ellipsis-${i}`}>
                              <Pagination.Ellipsis />
                            </Pagination.Item>
                          ) : (
                            <Pagination.Item key={p}>
                              <Pagination.Link
                                isActive={p === currentPage}
                                onPress={() => setCurrentPage(p)}
                              >
                                {p}
                              </Pagination.Link>
                            </Pagination.Item>
                          )
                        );
                      })()}

                      <Pagination.Item>
                        <Pagination.Next
                          isDisabled={currentPage === totalPages}
                          onPress={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        >
                          <span>Next</span>
                          <Pagination.NextIcon />
                        </Pagination.Next>
                      </Pagination.Item>
                    </Pagination.Content>
                  </Pagination>
                )}
              </div>
            )}

            {/* Show either just the latest release or paginated releases */}
            {(showAllVersions ?
              releases.slice((currentPage - 1) * 10, currentPage * 10) :
              [releases[0]]).map((release) => {
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
                          onPress={() => setShowAllPlatforms(!showAllPlatforms)}
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
                          onPress={() => setShowAllPlatforms(!showAllPlatforms)}
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
