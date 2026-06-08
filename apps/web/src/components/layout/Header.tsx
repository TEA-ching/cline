import { useTranslation } from 'react-i18next'
import { Button, Dropdown, Label, Typography } from '@heroui/react'
import githubIcon from '../../assets/GitHub_Invertocat_Black.svg'
/**
 * Header component for the ClinePool website
 * Includes navigation and language switcher
 */
export default function Header({ onLanguageChange }: { onLanguageChange: (lng: string) => void }) {
  const { t } = useTranslation('common')

  // Handle language change
  const handleLanguageChange = (lng: string) => {
    onLanguageChange(lng)
  }

  return (
      <header className="sticky top-0 z-40 w-full border-b border-separator bg-background/70 backdrop-blur-lg">
      <div className="container mx-auto flex h-14 items-center">
        {/* Logo */}
        <div className="mr-4 flex items-center">
          <Typography type="h4" weight="semibold" className="text-foreground">
            ClinePool
          </Typography>
        </div>

        {/* Navigation */}
        <nav className="flex flex-1 items-center space-x-6">
          <a href="#features" className="text-sm font-medium text-foreground/80 transition-colors hover:text-foreground">
            {t('header.features')}
          </a>
          <a href="#downloads" className="text-sm font-medium text-foreground/80 transition-colors hover:text-foreground">
            {t('header.downloads')}
          </a>
          <a href="#" className="text-sm font-medium text-foreground/80 transition-colors hover:text-foreground">
            {t('header.documentation')}
          </a>
        </nav>

        {/* Language switcher and GitHub button */}
        <div className="flex items-center space-x-4">
          <Dropdown>
            <Dropdown.Trigger>
              <Button variant="ghost" size="sm" className="gap-1">
                <span>{t('language.label')}</span>
              </Button>
            </Dropdown.Trigger>
            <Dropdown.Popover className="w-40">
              <Dropdown.Menu onAction={(key) => handleLanguageChange(key as string)}>
                <Dropdown.Item id="en-US" textValue="English">
                  <Label>{t('language.english')}</Label>
                </Dropdown.Item>
                <Dropdown.Item id="fr-FR" textValue="French">
                  <Label>{t('language.french')}</Label>
                </Dropdown.Item>
                <Dropdown.Item id="es-ES" textValue="Spanish">
                  <Label>{t('language.spanish')}</Label>
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>

          <a
            href="https://github.com/TEA-ching/cline"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground/60 transition-colors hover:text-foreground"
          >
            <span className="sr-only">{t('header.github')}</span>
            <img src={githubIcon} alt="GitHub" className="h-5 w-5" />
          </a>
        </div>
      </div>
    </header>
  )
}
