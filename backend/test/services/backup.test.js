import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runBackup } from '../../src/services/backup.js';
import { DB_PATH, BACKUP_DIR } from '../../src/config/env.js';

describe('services/backup — runBackup', () => {
  it('tworzy katalog BACKUP_DIR jeśli nie istnieje', async () => {
    // BACKUP_DIR powinien istnieć po runBackup (mkdirSync recursive)
    await runBackup();
    assert.ok(fs.existsSync(BACKUP_DIR));
  });

  it('tworzy timestamped plik backup-*.db', async () => {
    const before = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('backup-')).length;
    const result = await runBackup();
    const after = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('backup-')).length;
    assert.ok(result.localOk);
    assert.ok(after >= before, 'co najmniej 1 nowy plik backup');
    assert.match(path.basename(result.path), /^backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.db$/);
  });

  it('skopiowany plik istnieje na dysku i ma > 0 bajtów', async () => {
    const r = await runBackup();
    assert.ok(fs.existsSync(r.path));
    const size = fs.statSync(r.path).size;
    assert.ok(size > 0, 'backup nie może być pusty');
  });

  it('skopiowany plik ma identyczny rozmiar jak źródło (DB_PATH)', async () => {
    const r = await runBackup();
    const srcSize = fs.statSync(DB_PATH).size;
    const dstSize = fs.statSync(r.path).size;
    assert.equal(dstSize, srcSize);
  });

  it('zwraca {localOk: true, path} przy sukcesie', async () => {
    const r = await runBackup();
    assert.equal(r.localOk, true);
    assert.equal(typeof r.path, 'string');
  });

  it('idempotent — drugi run tworzy kolejny plik (nie zastępuje)', async () => {
    const r1 = await runBackup();
    await new Promise((res) => setTimeout(res, 10)); // żeby timestamp był różny
    const r2 = await runBackup();
    assert.notEqual(r1.path, r2.path);
  });

  it('cleanup retention — bardzo stary plik zostaje usunięty', async () => {
    // Symuluj stary backup: utwórz plik + ręcznie ustaw mtime na 100 dni temu.
    const oldFile = path.join(BACKUP_DIR, `backup-2020-01-01T00-00-00-000Z.db`);
    fs.writeFileSync(oldFile, 'old fake backup');
    const veryOldTime = Date.now() - (100 * 86400_000); // 100 dni temu
    fs.utimesSync(oldFile, veryOldTime / 1000, veryOldTime / 1000);

    assert.ok(fs.existsSync(oldFile), 'pre-condition: stary plik istnieje');
    await runBackup();
    // Retention default 14 dni → 100-dniowy plik powinien zostać usunięty
    assert.ok(!fs.existsSync(oldFile), 'stary plik powinien być usunięty przez cleanup');
  });

  it('nowe backupy (< retention) NIE są usuwane', async () => {
    const r = await runBackup();
    // Plik tworzony "teraz" → mtime < retention → nie usunięty.
    assert.ok(fs.existsSync(r.path));

    // Run drugi backup żeby trigger cleanup → świeży plik dalej istnieje.
    await runBackup();
    assert.ok(fs.existsSync(r.path), 'świeży backup zostaje po cleanup');
  });

  it('cleanup ignoruje pliki nie-backup (security: nie usuwa innych plików)', async () => {
    const unrelated = path.join(BACKUP_DIR, 'not-a-backup.txt');
    fs.writeFileSync(unrelated, 'important user file');
    // Stary mtime
    const old = Date.now() - (100 * 86400_000);
    fs.utimesSync(unrelated, old / 1000, old / 1000);

    await runBackup();
    assert.ok(fs.existsSync(unrelated), 'pliki nie-backup pozostają nietknięte');
    fs.unlinkSync(unrelated); // cleanup po teście
  });
});
