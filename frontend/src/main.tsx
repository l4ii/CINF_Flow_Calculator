import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
/* KaTeX @font-face：须在首屏前加载，全文英文/数字方可稳定使用 KaTeX_Main */
import 'katex/dist/katex.min.css'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
