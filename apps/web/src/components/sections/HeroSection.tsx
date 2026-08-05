import { useTranslation } from 'react-i18next'
import { Button, Typography } from '@heroui/react'

/**
 * Hero section component for the ClinePool website
 * Displays the main value proposition and call-to-action
 */
export default function HeroSection() {
  const { t } = useTranslation('common')

  return (
    <section className="relative overflow-hidden py-20 md:py-28 lg:py-32">
      <div className="container relative z-10">
        <div className="mx-auto max-w-3xl text-center">
          {/* Hero title */}
          <Typography type="h1" className="mb-6">
            {t('hero.title')}
          </Typography>

          {/* Hero subtitle */}
          <Typography type="body" color="muted" className="mb-10 max-w-2xl mx-auto">
            {t('hero.subtitle')}
          </Typography>

          {/* Call to action buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="min-w-[180px]">
              {t('hero.ctaPrimary')}
            </Button>
            <Button size="lg" variant="secondary" className="min-w-[180px]">
              {t('hero.ctaSecondary')}
            </Button>
          </div>
        </div>
      </div>

      {/* Background grid pattern */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:60px_60px] [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)]"></div>
      </div>
    </section>
  )
}
