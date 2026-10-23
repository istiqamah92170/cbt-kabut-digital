/* ghp-bridge.js -- Jembatan Alat Premium <-> Guru Hub (CBT Kabut Digital)
 *
 * Dipasang di <head> aplikasi premium (KEA, GuruAI Builder) SEBELUM skrip lain:
 *   <script src="ghp-bridge.js" data-app="kea"
 *           data-kunci="mts_db,mts_db_changelog,mts_sessions"
 *           data-url-server="https://script.google.com/macros/s/.../exec"
 *           data-url-guruhub="https://ALAMAT-GURU-HUB"></script>
 *
 * Fungsi:
 *  1. GERBANG: aplikasi hanya terbuka bila (a) berada di dalam iframe, (b) membawa
 *     tiket (#tiket=...) yang disahkan server Lisensi. Selain itu -> terkunci (fail-closed).
 *  2. SINKRON: nilai localStorage pada data-kunci dikirim ke Guru Hub lewat postMessage
 *     (Guru Hub yang bicara ke server; aplikasi TIDAK pernah memegang kunciGuru).
 *     Pada saat buka, data server yang lebih baru diterapkan (aplikasi dimuat ulang sekali).
 * Catatan: gerbang ini "lunak" -- berkas HTML statis tetap bisa diunduh orang; yang
 * dijaga adalah penggunaan & data. */
(function () {
  'use strict';
  var script = document.currentScript;
  var APP = (script && script.getAttribute('data-app')) || '';
  var KUNCI = ((script && script.getAttribute('data-kunci')) || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  var URL_SERVER = (script && script.getAttribute('data-url-server')) || '';
  var URL_HUB = (script && script.getAttribute('data-url-guruhub')) || '';
  // Dukungan IndexedDB (mis. GuruAI Builder): data-idb="namaDB:versi:namaStore", data-idb-kecuali="kunci1,kunci2".
  // Kunci IDB disinkronkan sebagai 'idb:<kunci>' (nilai = JSON.stringify).
  var IDB_SPEC = ((script && script.getAttribute('data-idb')) || '').split(':');
  var IDB_NAME = IDB_SPEC[0] || '', IDB_VER = parseInt(IDB_SPEC[1] || '1', 10), IDB_STORE = IDB_SPEC[2] || '';
  var IDB_KECUALI = ((script && script.getAttribute('data-idb-kecuali')) || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  if (!IDB_STORE) IDB_NAME = '';
  // data-tunda="_result_,...": kunci IDB yang mengandung teks ini TIDAK diunduh otomatis ke perangkat yang belum punya;
  // aplikasi memintanya saat perlu lewat GHP.minta([...kunciIdb]). Menghemat unduhan saat perangkat baru memuat banyak proyek.
  var TUNDA = ((script && script.getAttribute('data-tunda')) || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  var permintaan = {}, ridN = 0;
  var cacheTerakhir = {}, memproses = false;
  // data-sembunyi="kunci:medan1,medan2;kunci2:medan": medan RAHASIA/PRIBADI di dalam nilai JSON suatu kunci
  // (mis. URL & kunci rahasia cadangan pribadi guru). Medan ini TIDAK PERNAH keluar dari perangkat:
  // dibuang sebelum dikirim, dan saat data server diterapkan, nilai lokalnya dipertahankan.
  var SEMBUNYI = {};
  ((script && script.getAttribute('data-sembunyi')) || '').split(';').forEach(function (r) {
    var p = r.split(':'); if (p.length === 2 && p[0].trim()) SEMBUNYI[p[0].trim()] = p[1].split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  });
  function saring(k, str) {
    if (!SEMBUNYI[k] || typeof str !== 'string') return str;
    try { var o = JSON.parse(str); if (o && typeof o === 'object') { SEMBUNYI[k].forEach(function (f) { delete o[f]; }); return JSON.stringify(o); } } catch (e) {}
    return str;
  }
  function gabung(k, nilaiServer, nilaiLokal) { // server (sudah disaring) + medan rahasia milik perangkat ini
    if (!SEMBUNYI[k] || typeof nilaiServer !== 'string') return nilaiServer;
    try {
      var o = JSON.parse(saring(k, nilaiServer)), l = nilaiLokal ? JSON.parse(nilaiLokal) : {};
      SEMBUNYI[k].forEach(function (f) { if (l && l[f] !== undefined) o[f] = l[f]; });
      return JSON.stringify(o);
    } catch (e) { return nilaiServer; }
  }
  var ORIGIN_HUB = '';
  try { if (URL_HUB) ORIGIN_HUB = new URL(URL_HUB, location.href).origin; } catch (e) {}

  var SK_TIKET = 'ghp_tiket_' + APP, LK_OK = 'ghp_ok_' + APP, SK_RELOAD = 'ghp_reload_' + APP, LK_META = 'ghp_meta_' + APP;
  var GRACE_OFFLINE_MS = 3 * 24 * 3600 * 1000, VERIF_ULANG_MS = 20 * 60 * 1000, TUNGGU_INIT_MS = 15000;

  var _get = Storage.prototype.getItem, _set = Storage.prototype.setItem, _rem = Storage.prototype.removeItem;
  var siap = false, terbuka = false, terkunci = false, originInduk = '', tiket = '';
  var meta = {}, pending = {}, timerKirim = null, penunggu = [];

  function ss(op, k, v) { try { if (op === 'g') return sessionStorage.getItem(k); if (op === 's') sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch (e) {} return null; }
  function bacaMeta() { try { meta = JSON.parse(_get.call(localStorage, LK_META) || '{}') || {}; } catch (e) { meta = {}; } }
  function tulisMeta() { try { _set.call(localStorage, LK_META, JSON.stringify(meta)); } catch (e) {} }

  function kunci(pesan) {
    if (terkunci) return; terkunci = true; terbuka = false; siap = false;
    function tampil() {
      document.documentElement.style.overflow = 'hidden';
      var b = document.body || document.documentElement;
      b.innerHTML = '<div style="position:fixed;inset:0;z-index:2147483647;background:#0b1410;color:#e8f3ee;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,sans-serif;text-align:center"><div style="max-width:380px"><div style="font-size:44px">\uD83D\uDD12</div><h2 style="margin:10px 0 8px;font-size:19px">Alat Premium Guru Hub</h2><p style="line-height:1.6;color:#b9cfc5;font-size:14px">' + pesan + '</p></div></div>';
    }
    if (document.body) tampil(); else document.addEventListener('DOMContentLoaded', tampil);
  }

  function kePar(msg) {
    msg._sumber = 'ghp-app'; msg.app = APP;
    try { window.parent.postMessage(msg, ORIGIN_HUB || '*'); } catch (e) {}
  }

  // ---- gerbang ----
  if (window.parent === window) { return void (window.GHP = { terbuka: false }, kunci('Aplikasi ini hanya bisa dibuka dari dalam <b>Guru Hub</b> dengan langganan aktif.')); }
  var h = location.hash || '';
  var m = /[#&]tiket=([^&]+)/.exec(h);
  if (m) {
    try { ss('s', SK_TIKET, decodeURIComponent(m[1])); } catch (e) {}
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  }
  tiket = ss('g', SK_TIKET) || '';
  if (!tiket) { return void (window.GHP = { terbuka: false }, kunci('Tiket akses tidak ditemukan. Buka aplikasi ini lewat menu <b>Alat Premium</b> di Guru Hub.')); }

  bacaMeta();

  // ---- pantau perubahan localStorage pada kunci sinkron ----
  function sah(st, k) { return st === localStorage && KUNCI.indexOf(k) >= 0; }
  function catat(k, nilai) {
    var v = Date.now(); if (meta[k] && v <= meta[k]) v = meta[k] + 1;
    meta[k] = v; tulisMeta();
    pending[k] = { versi: v, nilai: nilai };
    clearTimeout(timerKirim); timerKirim = setTimeout(kirimPending, 700);
  }
  function kirimPending() {
    clearTimeout(timerKirim); timerKirim = null;
    Object.keys(pending).forEach(function (k) {
      kePar({ type: 'GHP_PERUBAHAN', tiket: tiket, kunci: k, versi: pending[k].versi, nilai: pending[k].nilai });
    });
    pending = {};
  }
  Storage.prototype.setItem = function (k, v) {
    if (!sah(this, k)) return _set.apply(this, arguments);
    var lama = _get.call(this, k); _set.call(this, k, v);
    if (siap && saring(k, lama) !== saring(k, String(v))) catat(k, saring(k, String(v)));
  };
  Storage.prototype.removeItem = function (k) {
    if (!sah(this, k)) return _rem.apply(this, arguments);
    var lama = _get.call(this, k); _rem.call(this, k);
    if (siap && lama !== null) catat(k, null);
  };

  // ---- IndexedDB ----
  function idbKecuali(k) { return typeof k !== 'string' || IDB_KECUALI.indexOf(k) >= 0; }
  function idbBuka() {
    return new Promise(function (res, rej) {
      var rq = indexedDB.open(IDB_NAME, IDB_VER);
      rq.onupgradeneeded = function (e) { var db = e.target.result; if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE); };
      rq.onsuccess = function (e) { res(e.target.result); };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  function bacaIdb() {
    if (!IDB_NAME) return Promise.resolve({});
    return idbBuka().then(function (db) {
      return new Promise(function (res) {
        var out = {};
        try {
          var c = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).openCursor();
          c.onsuccess = function (ev) {
            var cur = ev.target.result;
            if (cur) { if (!idbKecuali(cur.key)) { try { out[cur.key] = JSON.stringify(cur.value); } catch (e) {} } cur.continue(); }
            else { db.close(); res(out); }
          };
          c.onerror = function () { db.close(); res(out); };
        } catch (e) { db.close(); res(out); }
      });
    }, function () { return {}; });
  }
  var _iput = IDBObjectStore.prototype.put, _idel = IDBObjectStore.prototype['delete'];
  function terapkanIdb(daftar) { // daftar: [[kunciMentah, nilaiJsonAtauNull]]
    if (!IDB_NAME || !daftar.length) return Promise.resolve();
    return idbBuka().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction(IDB_STORE, 'readwrite'), st = tx.objectStore(IDB_STORE);
        daftar.forEach(function (p) { try { if (p[1] === null) _idel.call(st, p[0]); else _iput.call(st, JSON.parse(p[1]), p[0]); } catch (e) {} });
        tx.oncomplete = function () { db.close(); res(); };
        tx.onerror = tx.onabort = function () { db.close(); res(); };
      });
    }, function () {});
  }
  // Terapkan HANYA bila kunci belum ada di perangkat (jangan menimpa data yang sudah ditulis lokal).
  function terapkanBilaKosong(daftar) {
    if (!IDB_NAME || !daftar.length) return Promise.resolve();
    return idbBuka().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction(IDB_STORE, 'readwrite'), st = tx.objectStore(IDB_STORE);
        daftar.forEach(function (p) {
          try { var rq = st.get(p[0]); rq.onsuccess = function () { if (rq.result === undefined && p[1] !== null) { try { _iput.call(st, JSON.parse(p[1]), p[0]); } catch (e) {} } }; } catch (e) {}
        });
        tx.oncomplete = function () { db.close(); res(); };
        tx.onerror = tx.onabort = function () { db.close(); res(); };
      });
    }, function () {});
  }
  if (IDB_NAME) {
    IDBObjectStore.prototype.put = function (v, k) {
      var r = _iput.apply(this, arguments);
      try {
        if (typeof k === 'string' && !idbKecuali(k) && this.name === IDB_STORE && this.transaction.db.name === IDB_NAME) {
          var js = JSON.stringify(v);
          this.transaction.addEventListener('complete', function () {
            if (siap && cacheTerakhir['idb:' + k] !== js) { cacheTerakhir['idb:' + k] = js; catat('idb:' + k, js); }
          });
        }
      } catch (e) {}
      return r;
    };
    IDBObjectStore.prototype['delete'] = function (k) {
      var r = _idel.apply(this, arguments);
      try {
        if (typeof k === 'string' && !idbKecuali(k) && this.name === IDB_STORE && this.transaction.db.name === IDB_NAME) {
          this.transaction.addEventListener('complete', function () {
            if (siap && cacheTerakhir['idb:' + k] !== null && cacheTerakhir['idb:' + k] !== undefined) { cacheTerakhir['idb:' + k] = null; catat('idb:' + k, null); }
          });
        }
      } catch (e) {}
      return r;
    };
  }

  // ---- verifikasi tiket ke server ----
  function verifikasi() {
    if (!URL_SERVER) return Promise.reject({ tolak: true, msg: 'Konfigurasi server belum diisi.' });
    var url = URL_SERVER + '?action=verifikasiTiket&app=' + encodeURIComponent(APP) + '&tiket=' + encodeURIComponent(tiket);
    return fetch(url).then(function (r) { return r.text(); }).then(function (t) {
      var j; try { j = JSON.parse(t); } catch (e) { throw { jaringan: true }; }
      if (j && j.status === 'ok') { try { _set.call(localStorage, LK_OK, tiket + '|' + Date.now()); } catch (e) {} return true; }
      throw { tolak: true, msg: (j && j.msg) || 'Tiket tidak sah atau sudah kedaluwarsa.' };
    }, function () { throw { jaringan: true }; });
  }
  // Tiket yang SAMA pernah disahkan server dalam masa tenggang -> aplikasi langsung dibuka (tanpa menunggu jaringan),
  // pengesahan diulang di latar belakang. Tiket asing/baru selalu menunggu pengesahan server.
  function pernahSah() {
    try { var r = (_get.call(localStorage, LK_OK) || '').split('|'); return r[0] === tiket && Date.now() - parseInt(r[1] || '0', 10) < GRACE_OFFLINE_MS; } catch (e) { return false; }
  }
  function gagalVerif(e) {
    if (e && e.jaringan) {
      if (pernahSah()) return true; // sedang offline, masih dalam masa tenggang
      kunci('Tidak bisa memastikan langganan (tidak ada koneksi). Sambungkan internet lalu buka lagi lewat <b>Guru Hub</b>.'); return false;
    }
    kunci((e && e.msg ? e.msg : 'Akses ditolak.') + ' Buka ulang lewat menu <b>Alat Premium</b> di Guru Hub.'); return false;
  }

  // ---- pesan dari Guru Hub ----
  window.addEventListener('message', function (ev) {
    if (terkunci || ev.source !== window.parent) return;
    if (ORIGIN_HUB && ev.origin !== ORIGIN_HUB) return;
    var d = ev.data; if (!d || d._sumber !== 'ghp-hub' || d.app !== APP) return;
    if (d.type === 'GHP_INIT') {
      if (memproses || ((siap || terbuka) && !d.ulang)) return; // INIT ulang hanya bila Hub memintanya (cocokkan ulang dengan Drive)
      memproses = true; originInduk = ev.origin; var berubah = false, idbDaftar = [];
      var t = d.terapkan || {};
      Object.keys(t).forEach(function (k) {
        if (k.indexOf('idb:') === 0) {
          if (!IDB_NAME || idbKecuali(k.slice(4))) return;
          idbDaftar.push([k.slice(4), t[k].nilai]); cacheTerakhir[k] = t[k].nilai; meta[k] = t[k].versi; berubah = true; return;
        }
        if (KUNCI.indexOf(k) < 0) return;
        try { if (t[k].nilai === null) _rem.call(localStorage, k); else _set.call(localStorage, k, gabung(k, t[k].nilai, _get.call(localStorage, k))); } catch (e) {}
        meta[k] = t[k].versi; berubah = true;
      });
      var vs = d.versi || {}; Object.keys(vs).forEach(function (k) { meta[k] = vs[k]; });
      tulisMeta();
      terapkanIdb(idbDaftar).then(function () {
        if (berubah && (d.ulang || ss('g', SK_RELOAD) !== tiket)) { ss('s', SK_RELOAD, tiket); location.reload(); return; }
        ss('r', SK_RELOAD);
        terbuka = true; siap = true; memproses = false; window.GHP.terbuka = true; window.GHP.originInduk = originInduk;
        // Sekali saja: kirim ulang nilai yang SUDAH disaring supaya salinan lama di server (dari versi sebelum
        // penyaringan ada) tergantikan -- medan rahasia tidak tersisa di server.
        try {
          if (Object.keys(SEMBUNYI).length && _get.call(localStorage, 'ghp_sanit1_' + APP) !== '1') {
            Object.keys(SEMBUNYI).forEach(function (k) { var v = _get.call(localStorage, k); if (v !== null && saring(k, v) !== v) catat(k, saring(k, v)); }); // hanya bila nilai lokal memang memuat medan rahasia (hindari versi baru yang tidak perlu)
            _set.call(localStorage, 'ghp_sanit1_' + APP, '1');
          }
        } catch (e) {}
        penunggu.splice(0).forEach(function (f) { try { f(); } catch (e) {} });
      });
    } else if (d.type === 'GHP_SEMUA') {
      // Hub meminta SEMUA data lokal dikirim (mis. baru menghubungkan Google Drive di tengah sesi).
      if (!siap) return;
      KUNCI.forEach(function (k) {
        var v = _get.call(localStorage, k); if (v === null) return;
        var ver = meta[k] || (meta[k] = Date.now()); tulisMeta();
        kePar({ type: 'GHP_PERUBAHAN', tiket: tiket, kunci: k, versi: ver, nilai: saring(k, v) });
      });
      bacaIdb().then(function (idb) {
        Object.keys(idb).forEach(function (k) {
          var ver = meta['idb:' + k] || (meta['idb:' + k] = Date.now());
          kePar({ type: 'GHP_PERUBAHAN', tiket: tiket, kunci: 'idb:' + k, versi: ver, nilai: idb[k] });
        });
        tulisMeta();
      });
    } else if (d.type === 'GHP_DATA') {
      var pm = d.rid && permintaan[d.rid]; if (!pm) return;
      var daftarD = [], tt = d.terapkan || {};
      Object.keys(tt).forEach(function (k) {
        if (k.indexOf('idb:') !== 0 || !IDB_NAME || idbKecuali(k.slice(4))) return;
        daftarD.push([k.slice(4), tt[k].nilai]); cacheTerakhir[k] = tt[k].nilai; if (!meta[k]) meta[k] = tt[k].versi;
      });
      tulisMeta();
      terapkanBilaKosong(daftarD).then(function () { clearTimeout(pm.t); delete permintaan[d.rid]; pm.res(!(d.gagal && d.gagal.length)); });
    } else if (d.type === 'GHP_ULANG') {
      // Hub meminta pencocokan ulang dengan Drive (mis. Drive baru dihubungkan di tengah sesi). Tidak mengirim apa pun sendiri.
      if (siap) kirimHello();
    } else if (d.type === 'GHP_FLUSH') {
      kirimPending(); kePar({ type: 'GHP_FLUSH_OK', tiket: tiket });
    } else if (d.type === 'GHP_TUTUP') {
      kunci('Sesi ditutup. Buka lagi lewat <b>Guru Hub</b>.');
    }
  });
  window.addEventListener('pagehide', kirimPending);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') kirimPending(); });

  function kirimHello() {
    var lokal = {};
    KUNCI.forEach(function (k) { var v = _get.call(localStorage, k); lokal[k] = { versi: meta[k] || 0, nilai: saring(k, v) }; });
    bacaIdb().then(function (idb) {
      Object.keys(idb).forEach(function (k) { cacheTerakhir['idb:' + k] = idb[k]; lokal['idb:' + k] = { versi: meta['idb:' + k] || 0, nilai: idb[k] }; });
      kePar({ type: 'GHP_HELLO', tiket: tiket, lokal: lokal, tunda: TUNDA });
    });
  }

  window.GHP = {
    app: APP, terbuka: false, originInduk: '',
    saatTerbuka: function (fn) { if (terbuka) { try { fn(); } catch (e) {} } else penunggu.push(fn); },
    simpanSekarang: kirimPending,
    // minta isi kunci IDB (nama fisik, tanpa awalan 'idb:') yang ditunda. Resolve true bila semua didapat/tidak ada di Drive.
    minta: function (kunciIdb) {
      return new Promise(function (res) {
        if (!terbuka || !kunciIdb || !kunciIdb.length) { res(true); return; }
        var rid = 'r' + (++ridN);
        permintaan[rid] = { res: res, t: setTimeout(function () { delete permintaan[rid]; res(false); }, 70000) };
        kePar({ type: 'GHP_MINTA', tiket: tiket, rid: rid, kunci: kunciIdb.map(function (k) { return 'idb:' + k; }) });
      });
    }
  };

  function mulaiHello() {
    var n = 0;
    (function ulang() {
      if (terbuka || terkunci) return;
      if (n++ * 2000 >= TUNGGU_INIT_MS) { kunci('Tidak terhubung ke Guru Hub. Tutup lalu buka lagi lewat menu <b>Alat Premium</b>.'); return; }
      kirimHello(); setTimeout(ulang, 2000);
    })();
    setInterval(function () { verifikasi().then(null, function (e) { if (e && e.tolak) gagalVerif(e); }); }, VERIF_ULANG_MS);
  }
  if (pernahSah()) {
    mulaiHello(); // buka cepat
    verifikasi().then(null, function (e) { if (e && e.tolak) gagalVerif(e); }); // pengesahan di latar belakang
  } else {
    verifikasi().then(function () { return true; }, gagalVerif).then(function (lanjut) { if (lanjut) mulaiHello(); });
  }
})();
