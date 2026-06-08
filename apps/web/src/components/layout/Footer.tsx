import { useTranslation } from 'react-i18next'
import { Typography } from '@heroui/react'

/**
 * Footer component for the ClinePool website
 * Includes copyright information and links
 */
export default function Footer() {
  const { t } = useTranslation('common')

  return (
    <footer className="sticky top-0 z-40 w-full border-t border-separator bg-background/70 backdrop-blur-lg">
      <div className="container mx-auto px-4 py-12 flex flex-col">
        {/* Main content grid */}
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3 mb-8">
          {/* Brand and description */}
          <div>
            <Typography type="h4" weight="semibold" className="mb-3">
              ClinePool
            </Typography>
            <Typography type="body-sm" color="muted" className="max-w-xs">
              {t('footer.description')}
            </Typography>
          </div>

          {/* Quick links */}
          <div>
            <Typography type="h5" className="mb-4">
              {t('footer.quickLinks')}
            </Typography>
            <ul className="space-y-2">
              <li>
                <a href="#features" className="text-sm text-foreground/80 transition-colors hover:text-foreground">
                  {t('footer.features')}
                </a>
              </li>
              <li>
                <a href="#downloads" className="text-sm text-foreground/80 transition-colors hover:text-foreground">
                  {t('footer.downloads')}
                </a>
              </li>
              <li>
                <a href="#" className="text-sm text-foreground/80 transition-colors hover:text-foreground">
                  {t('footer.documentation')}
                </a>
              </li>
            </ul>
          </div>

          {/* Legal links */}
          <div>
            <Typography type="h5" className="mb-4">
              {t('footer.legal')}
            </Typography>
            <ul className="space-y-2">
              <li>
                <a href="#" className="text-sm text-foreground/80 transition-colors hover:text-foreground">
                  {t('footer.privacyPolicy')}
                </a>
              </li>
              <li>
                <a href="#" className="text-sm text-foreground/80 transition-colors hover:text-foreground">
                  {t('footer.termsOfService')}
                </a>
              </li>
              <li>
                <a href="#" className="text-sm text-foreground/80 transition-colors hover:text-foreground">
                  {t('footer.license')}
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Copyright section at the bottom */}
        <div className="pt-6 border-t border-border text-center">
            <Typography type="body-sm" color="muted">
              {t('footer.copyright', { year: new Date().getFullYear() })}
            </Typography>
        </div>
      </div>
    </footer>
  )
}
