import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/global.css'
import './i18n/config'

// Create root element and render the app
const rootElement = document.getElementById('root')

if (rootElement) {
  const root = createRoot(rootElement)
  root.render(<App />)
}
