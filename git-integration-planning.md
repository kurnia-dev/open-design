# Perencanaan Integrasi GitHub & Sinkronisasi Git Workspace

Dokumen ini berisi perencanaan teknis untuk menambahkan integrasi penuh ke GitHub, yang memungkinkan penyimpanan kredensial akun, sinkronisasi (push & pull) project workspace ke remote repository (termasuk repositori privat), serta mendukung kloning repositori privat untuk sistem desain (Design System).

---

## 1. Konteks & Analisis Arsitektur

Saat ini, modul Git di Open Design baru mendukung operasi lokal seperti `git status`, `git add`, `git restore`, dan `git commit`. Tidak ada mekanisme untuk melakukan `git push` atau `git pull`, serta belum ada cara menyimpan autentikasi akun GitHub untuk berinteraksi dengan repositori privat (baik untuk impor Design System maupun sync project).

### Skema Autentikasi yang Diusulkan:
1. **GitHub Personal Access Token (PAT)**: Pengguna dapat menghubungkan akun GitHub mereka menggunakan token akses personal (PAT) melalui pengaturan UI Web.
2. **Penyimpanan Kredensial**: Token akan disimpan dengan aman di sisi lokal daemon (`github-tokens.json` dengan hak akses `0600` di dalam folder data `.od`).
3. **Autentikasi Perintah Git**: Saat melakukan `git clone`, `git push`, atau `git pull` ke repositori privat, daemon akan menyisipkan token secara dinamis ke URL remote proses git menggunakan format:
   `https://x-access-token:<TOKEN>@github.com/owner/repo.git`
   Hal ini menghindari perlunya modifikasi konfigurasi git global atau penyimpanan kredensial tingkat OS.

---

## 2. Berkas Terkait & Tempat Penambahan Fitur

Fitur ini akan membutuhkan perubahan di sisi **Daemon (Backend)**, **Web (Frontend)**, dan **Contracts (Tipe TypeScript)**:

### A. Daemon / Backend (`apps/daemon`)

1. **[NEW] `apps/daemon/src/github-tokens.ts`**
   * Mengelola penyimpanan berkas token `<dataDir>/github-tokens.json`.
   * Menyediakan fungsi:
     * `getGitHubToken(dataDir)`: Membaca token terenkripsi/aman dari disk.
     * `setGitHubToken(dataDir, token)`: Menyimpan token baru secara atomik.
     * `clearGitHubToken(dataDir)`: Menghapus token (disconnect).
   * Membatasi hak akses file dengan `chmod(file, 0o600)` pada POSIX.

2. **`apps/daemon/src/design-system-github-import.ts`**
   * Memodifikasi fungsi `importGitHubDesignSystemProject` agar memeriksa keberadaan token GitHub yang tersimpan.
   * Jika ada token, URL repositori yang akan dikloning diubah ke format berautentikasi (`https://x-access-token:<TOKEN>@github.com/...`) sebelum memanggil `git clone`.

3. **`apps/daemon/src/project-routes.ts`**
   * Menambahkan REST API endpoint baru:
     * `GET /api/github/auth-status`: Memeriksa apakah akun terhubung (dan melakukan request ke `https://api.github.com/user` untuk mengambil info username & avatar).
     * `POST /api/github/connect`: Menerima input token GitHub PAT, memverifikasinya, dan menyimpannya.
     * `POST /api/github/disconnect`: Menghapus token GitHub terdaftar.
     * `GET /api/projects/:id/git/remote`: Mendapatkan remote URL repositori proyek saat ini.
     * `POST /api/projects/:id/git/remote`: Mengatur remote URL repositori.
     * `POST /api/projects/:id/git/pull`: Melakukan `git pull` menggunakan token GitHub.
     * `POST /api/projects/:id/git/push`: Melakukan `git push` menggunakan token GitHub.
     * `GET /api/projects/:id/git/sync-status`: Membandingkan status commit lokal dengan remote branch (ahead/behind counts).

### B. Web / Frontend (`apps/web`)

1. **`apps/web/src/providers/registry.ts`**
   * Mendaftarkan fungsi pemanggil REST API baru agar bisa digunakan di React:
     * `fetchGitHubAuthStatus`, `connectGitHub`, `disconnectGitHub`
     * `fetchProjectGitRemote`, `setProjectGitRemote`
     * `pullProjectGit`, `pushProjectGit`
     * `fetchProjectGitSyncStatus`

2. **`apps/web/src/components/GitWorkspacePanel.tsx`**
   * Menambahkan UI di bagian sidebar atas:
     * Tampilan status akun GitHub (contoh: *"Terhubung sebagai @username"* beserta foto avatar, atau banner *"GitHub tidak terhubung"*).
     * Form sederhana untuk memasukkan GitHub Personal Access Token (PAT).
     * Tombol **Push** dan **Pull** di samping tombol commit.
     * Indikator status sinkronisasi, misalnya: *"2 commits ahead"* (perlu push), *"1 commit behind"* (perlu pull), atau *"Synced"*.

### C. Contracts (`packages/contracts`)

1. **`packages/contracts/src/api/github.ts`**
   * Mendefinisikan interface data transfer objek (DTO) untuk payload API integrasi GitHub.

---

## 3. Rencana Pengujian & Validasi

* **Verifikasi Autentikasi**: Memastikan token PAT yang salah ditolak oleh API GitHub dan memunculkan error yang jelas di UI.
* **Verifikasi Repositori Privat**: Kloning Design System dari repositori GitHub privat dan pastikan token disisipkan dengan benar dan kloning berhasil.
* **Verifikasi Sinkronisasi Project**: Membuat project lokal, mengeset remote ke repositori GitHub privat yang kosong/ada, lalu melakukan komit, Push, dan Pull dari UI Web Open Design.
