# Kodierbox manuell von PostgreSQL 14 auf 17 umstellen

Beim Anwendungsupdate Ihre bisherige `.env.coding-box` beibehalten. Solange `POSTGRES_IMAGE_SUFFIX` fehlt oder leer ist, nutzt die Docker-Installation weiterhin PostgreSQL 14.

1. **Wartungsfenster beginnen.** Laufende Jobs abschließen lassen. Backend, Export-Worker und andere schreibende Zugriffe anhalten. Die aktive `.env.coding-box` sichern und den Namen des bisherigen Datenvolumes festhalten.
2. **Sichern.** Mit den PostgreSQL-17-Werkzeugen die Rollen (`pg_dumpall --roles-only`) und die Kodierbox-Datenbank (`pg_dump -Fc`) geschützt sichern. Das bisherige Volume für den Rückfall aufbewahren.
3. **Wiederherstellen.** Eine separate PostgreSQL-17-Instanz mit dem Image `iqbberlin/coding-box-db:<Release>-pg17`, einem neuen, leeren Volume und einem eigenen, auf der Quelle unbenutzten Administratornamen starten. Rollen mit `psql -v ON_ERROR_STOP=1 -d postgres` einspielen, dann die Datenbank mit `pg_restore --exit-on-error --create -d postgres` wiederherstellen. Tabellenbestände, Sequenzstände und Zugriffsrechte mit der Quelle vergleichen.
4. **Umschalten.** Nach erfolgreicher Prüfung die separate Instanz stoppen. In der aktiven `.env.coding-box` die folgenden Werte setzen. Den Platzhalter durch den tatsächlichen Namen des geprüften Volumes ersetzen.

   ```dotenv
   POSTGRES_IMAGE_SUFFIX=-pg17
   POSTGRES_DATA_VOLUME=<Name des wiederhergestellten Volumes>
   POSTGRES_DATA_VOLUME_EXTERNAL=true
   ```

5. **Freigeben.** Zuerst nur den regulären Dienst `db` mit der Produktionskonfiguration neu erstellen. Das eingebundene Volume und die Ausgabe von `SHOW server_version;` (17.x) prüfen. Erst dann Backend und Worker starten und die Kodierbox wieder freigeben.

**Rückfall.** Bis zur Schreibfreigabe auf PostgreSQL 17 können Sie die gesicherte Konfiguration wiederherstellen und `db` mit dem alten Volume neu erstellen. Spätere Änderungen liegen nur auf dem neuen Volume.

[PostgreSQL-Dokumentation zum Versionswechsel](https://www.postgresql.org/docs/17/upgrading.html)
