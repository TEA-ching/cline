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
  const [totalReleasesCount, setTotalReleasesCount] = useState(0)
  const itemsPerPage = 10

  // Get user's platform with improved detection
  const getUserPlatform = () => {
    const userAgent = navigator.userAgent.toLowerCase()
    
    // Detect iPad (even when userAgent doesn't contain "Mac")
    const isIPad = /ipad|macintosh/.test(userAgent) && 'ontouchend' in document
    
    if (isIPad || userAgent.includes('iphone') || userAgent.includes('ipod')) {
      return 'ios'
    }
    if (userAgent.includes('mac') && !isIPad) return 'darwin'
    if (userAgent.includes('win')) return 'win32'
    if (userAgent.includes('linux')) {
      // Check for alpine or other linux variants
      if (userAgent.includes('alpine')) return 'alpine'
      return 'linux'
    }
    return 'win32' // default
  }

  // Get user's architecture
  const getUserArchitecture = () => {
    const userAgent = navigator.userAgent.toLowerCase()
    
    // Specific detection for iPad
    const isIPad = /ipad|macintosh/.test(userAgent) && 'ontouchend' in document
    if (isIPad) {
      // Modern iPads (2017+) are arm64
      return 'arm64'
    }
    
    if (userAgent.includes('arm64') || userAgent.includes('aarch64')) return 'arm64'
    if (userAgent.includes('armhf')) return 'armhf'
    return 'x64' // default
  }

  // Fetch releases from GitHub with pagination to avoid API spam
  const fetchReleases = async (page = 1) => {
    try {
      setLoading(true)
      setError(null)

      const octokit = new Octokit()
      
      // First, get total count by fetching first page only
      const firstPageResponse = await octokit.rest.repos.listReleases({
        owner: 'TEA-ching',
        repo: 'cline',
        per_page: itemsPerPage,
        page: 1
      })

      // Filter preview releases on first page to get total count
      const allPreviewReleases: any[] = []
      let currentPage = 1
      let hasMore = true
      
      // Fetch all pages to get total count (only once when component mounts)
      // This is necessary to know total pages for pagination UI
      while (hasMore && currentPage <= 10) { // Limit to 10 pages max to prevent API spam
        const response = await octokit.rest.repos.listReleases({
          owner: 'TEA-ching',
          repo: 'cline',
          per_page: itemsPerPage,
          page: currentPage
        })
        
        const previewReleasesOnPage = response.data.filter((release: any) =>
          release.prerelease && release.tag_name.startsWith('preview/')
        )
        
        allPreviewReleases.push(...previewReleasesOnPage)
        
        // Check if we've reached the end
        if (response.data.length < itemsPerPage) {
          hasMore = false
        } else {
          currentPage++
        }
      }
      
      // Sort by published_at date (newest first)
      allPreviewReleases.sort((a: any, b: any) =>
        new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
      )
      
      setTotalReleasesCount(allPreviewReleases.length)
      setReleases(allPreviewReleases)
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

  // Get platform-specific assets based on naming convention
  const getPlatformAssets = (release: any) => {
    const userPlatform = getUserPlatform()
    const userArch = getUserArchitecture()

    return release.assets.filter((asset: any) => {
      const assetName = asset.name
      
      // Handle iOS/iPad special case
      if (userPlatform === 'ios') {
        return assetName.includes('darwin') && assetName.includes('arm64')
      }
      
      // Match assets for user's platform and architecture
      // Assets follow pattern: clinepool-{version}-{platform}-{arch}.{ext}
      if (assetName.includes(userPlatform) && assetName.includes(userArch)) {
        return true
      }
      
      return false
    })
  }

  // Get all platform assets for a release
  const getAllPlatformAssets = (release: any) => {
    return release.assets.filter((asset: any) =>
      asset.name.includes('clinepool-cli') || 
      (asset.name.includes('clinepool-') && asset.name.endsWith('.vsix'))
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

  // Calculate pagination
  const totalPages = Math.ceil(totalReleasesCount / itemsPerPage)
  
  // Get releases for current page when showing all versions
  const getCurrentPageReleases = () => {
    if (!showAllVersions) {
      // Only show the latest release (first item after sorting)
      return releases.slice(0, 1)
    }
    
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    return releases.slice(startIndex, endIndex)
  }

  // Generate pagination items for HeroUI v3 Pagination component
  const getPaginationItems = () => {
    const items = []
    const maxVisible = 5
    let start = Math.max(1, currentPage - Math.floor(maxVisible / 2))
    let end = Math.min(totalPages, start + maxVisible - 1)
    
    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1)
    }

    for (let i = start; i <= end; i++) {
      items.push(i)
    }
    return items
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
            {totalReleasesCount > 1 && (
              <div className="flex justify-between items-center mb-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => {
                    setShowAllVersions(!showAllVersions)
                    setCurrentPage(1)
                  }}
                >
                  {showAllVersions ? t('download.hideOlderVersions') : t('download.showOlderVersions')}
                </Button>

                {/* Pagination controls when showing all versions */}
                {showAllVersions && totalPages > 1 && (
                  <Pagination size="md">
                    <Pagination.Content className="gap-2">
                      {/* Previous button */}
                      <Pagination.Item>
                        <Pagination.Previous
                          isDisabled={currentPage === 1}
                          onPress={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        >
                          <Pagination.PreviousIcon />
                          <span className="sr-only">Previous</span>
                        </Pagination.Previous>
                      </Pagination.Item>

                      {/* First page with ellipsis */}
                      {currentPage > 3 && totalPages > 5 && (
                        <>
                          <Pagination.Item>
                            <Pagination.Link onPress={() => setCurrentPage(1)}>
                              1
                            </Pagination.Link>
                          </Pagination.Item>
                          <Pagination.Item>
                            <Pagination.Ellipsis />
                          </Pagination.Item>
                        </>
                      )}

                      {/* Page numbers */}
                      {getPaginationItems().map((pageNum) => (
                        <Pagination.Item key={pageNum}>
                          <Pagination.Link
                            isActive={currentPage === pageNum}
                            onPress={() => setCurrentPage(pageNum)}
                          >
                            {pageNum}
                          </Pagination.Link>
                        </Pagination.Item>
                      ))}

                      {/* Last page with ellipsis */}
                      {currentPage < totalPages - 2 && totalPages > 5 && (
                        <>
                          <Pagination.Item>
                            <Pagination.Ellipsis />
                          </Pagination.Item>
                          <Pagination.Item>
                            <Pagination.Link onPress={() => setCurrentPage(totalPages)}>
                              {totalPages}
                            </Pagination.Link>
                          </Pagination.Item>
                        </>
                      )}

                      {/* Next button */}
                      <Pagination.Item>
                        <Pagination.Next
                          isDisabled={currentPage === totalPages}
                          onPress={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        >
                          <span className="sr-only">Next</span>
                          <Pagination.NextIcon />
                        </Pagination.Next>
                      </Pagination.Item>
                    </Pagination.Content>
                  </Pagination>
                )}
              </div>
            )}

            {/* Display releases for current page */}
            {getCurrentPageReleases().map((release) => {
              const platformAssets = getPlatformAssets(release)
              const allPlatformAssets = getAllPlatformAssets(release)
              
              // Separate VSIX and CLI assets
              const vsixAssets = platformAssets.filter((asset: any) => 
                asset.name.endsWith('.vsix')
              )
              const cliAssets = platformAssets.filter((asset: any) => 
                asset.name.includes('clinepool-cli')
              )

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

                  {/* VSIX Download Section */}
                  <div className="mb-6">
                    <Typography type="h5" className="mb-3">
                      {t('download.vsixTitle')}
                    </Typography>
                    <div className="space-y-2">
                      {vsixAssets.map((asset: any) => (
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

                      {/* All platforms VSIX (when expanded) */}
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

                  {/* CLI Download Section */}
                  <div>
                    <Typography type="h5" className="mb-3">
                      {t('download.cliTitle')}
                    </Typography>
                    <div className="space-y-2">
                      {cliAssets.map((asset: any) => (
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

                      {/* All platforms CLI (when expanded) */}
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
