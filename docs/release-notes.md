# Hinweise zum nächsten Release

## PostgreSQL für die Kodierbox

Neuinstallationen starten auf PostgreSQL 17.12. Bestehende Installationen auf PostgreSQL 14
können das Kodierbox-Release mit ihrer bisherigen `.env.coding-box` und ihrem vorhandenen
Datenvolume einspielen. Lassen Sie `POSTGRES_IMAGE_SUFFIX` auf solchen Systemen bis zur
Datenübernahme leer oder undefiniert. Ein neues Image allein kann ein 14er-Volume nicht öffnen.

Betreiber wählen ihr Wartungsfenster selbst. Wir empfehlen einen zeitnahen Wechsel,
da der PostgreSQL-Support für Version 14 am 12. November 2026 endete. Die Anleitung
beschreibt Sicherung, Übernahme in ein neues Volume, Prüfung und Rückfall vor der
Schreibfreigabe. Die separate Keycloak-Datenbank ist davon unabhängig.
[Betreiberanleitung für dieses Release](postgresql-17-migration.md) · [PostgreSQL-Supportfristen](https://www.postgresql.org/support/versioning/)
