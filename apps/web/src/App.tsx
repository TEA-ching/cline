import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Header from './components/layout/Header'
import HeroSection from './components/sections/HeroSection'
import FeaturesSection from './components/sections/FeaturesSection'
import DownloadSection from './components/sections/DownloadSection'
import Footer from './components/layout/Footer'

/**
 * Main App component for the ClinePool website
 */
export default function App() {
  const { i18n } = useTranslation()
  const [language, setLanguage] = useState(i18n.language)

  // Handle language change
  const handleLanguageChange = (lng: string) => {
    i18n.changeLanguage(lng)
    setLanguage(lng)
  }

  return (
    <div className="relative flex flex-col h-screen">
      {/* Header */}
      <Header onLanguageChange={handleLanguageChange} />

      {/* Main content */}
      <main className="container mx-auto max-w-7xl px-6 grow pt-16">
        <HeroSection />
        <FeaturesSection />
        <DownloadSection />
      </main>

      {/* Footer */}
      <Footer />
    </div>
  )
}
