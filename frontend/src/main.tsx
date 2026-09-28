import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
// Responsive overrides must follow the component styles in the final stylesheet.
import './layout.css';
createRoot(document.getElementById('root')!).render(<App />);
