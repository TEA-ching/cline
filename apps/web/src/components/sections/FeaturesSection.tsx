import { useTranslation } from 'react-i18next'
import { Card, Typography } from '@heroui/react'

/**
 * Features section component for the ClinePool website
 * Displays the key features of the platform
 */
export default function FeaturesSection() {
  const { t } = useTranslation('common')

  // Feature items with icons
  const features = [
    {
      id: 'voice',
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2a3 3 0 0 0-3 3c0 1.5-1 3-3 3s-3-1.5-3-3a3 3 0 0 0-3 3c0 1.5 1 3 3 3s3 1.5 3 3a3 3 0 0 0 3 3c1.5 0 3-1 3-3s1.5-3 3-3a3 3 0 0 0 3-3c0-1.5-1-3-3-3s-3 1.5-3 3z" />
        </svg>
      ),
      title: t('features.voiceCapabilities.title'),
      description: t('features.voiceCapabilities.description'),
    },
    {
      id: 'knowledge',
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
        </svg>
      ),
      title: t('features.knowledgeExtraction.title'),
      description: t('features.knowledgeExtraction.description'),
    },
    {
      id: 'code',
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
        </svg>
      ),
      title: t('features.codeGeneration.title'),
      description: t('features.codeGeneration.description'),
    },
    {
      id: 'workflows',
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
          <path d="M9 13a3 3 0 0 1 3-3" />
          <path d="M15 13a3 3 0 0 1 3-3" />
          <path d="M9 13l6 0" />
        </svg>
      ),
      title: t('features.agenticWorkflows.title'),
      description: t('features.agenticWorkflows.description'),
    },
  ]

  return (
    <section id="features" className="py-20 md:py-28 lg:py-32">
      <div className="container">
        {/* Section header */}
        <div className="mx-auto mb-16 max-w-3xl text-center">
          <Typography type="h2" className="mb-4">
            {t('features.title')}
          </Typography>
          <Typography type="body" color="muted" className="max-w-2xl mx-auto">
            {t('features.subtitle')}
          </Typography>
        </div>

        {/* Features grid */}
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <div key={feature.id}>
              <Card className="h-full p-6 transition-all hover:shadow-lg hover:border-accent">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  {feature.icon}
                </div>
                <Typography type="h4" className="mb-2">
                  {feature.title}
                </Typography>
                <Typography type="body" color="muted">
                  {feature.description}
                </Typography>
              </Card>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
