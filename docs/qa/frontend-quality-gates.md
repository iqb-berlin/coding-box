# Angular-Stilkonventionen

Selektoren verwenden `coding-box` in Kebab-Case. Der externe Metadaten-Host
`iqb-formly-duration` behält seinen vertraglich vorgegebenen Selektor.
Template-interne Member sind `protected`; Lifecycle-Hooks implementieren die
Angular-Interfaces. Direkte Klassenbindungen ersetzen `NgClass`.

`npx nx lint frontend` prüft Selektoren, Lifecycle-Interfaces und Klassenbindungen.
Die spätere vollständige Zoneless-PR ergänzt Accessibility- und CI-Gates.
