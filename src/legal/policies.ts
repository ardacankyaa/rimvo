export type LegalPage = 'privacy' | 'cookies' | 'terms';
export const legalTitles: Record<LegalPage, string> = {
  privacy: 'Gizlilik', cookies: 'Çerezler ve tercihler', terms: 'Kullanım koşulları',
};
export interface PolicySection { readonly heading: string; readonly paragraphs: readonly string[] }
export const policyVersion = '2026-10-18';
export const policies: Record<LegalPage, readonly PolicySection[]> = {
  privacy: [
    { heading: 'Müzik cihazında kalır', paragraphs: [
      'RIMVO, açık kaynaklı bir tarayıcı DJ uygulamasıdır. Bu metin yerel sürümün davranışını açıklar. Hesap, reklam, analiz hizmeti veya medya yükleme sunucusu içermez.',
      'Seçtiğin ses dosyaları, dosya adı, boyutu, parça bilgisi ve kapak görseli tarayıcıda okunur. Dalga biçimi, BPM ve ton analizi cihazında yapılır; uygulama bu içeriği bir sunucuya göndermez. Mikrofon, kişiler veya konum izni istemez.',
    ] },
    { heading: 'Kayıt ve saklama', paragraphs: [
      'Mix kaydı yalnız sen başlattığında, uygulamanın ses çıkışından oluşturulur. Kayıt ve yeni sürümleri cihazına indirilebilir veya cihazının paylaşım menüsüne gönderilebilir. Kaynak ses dosyalarının üzerine yazılmaz. Paylaşımı onayladığında seçtiğin uygulama ya da hizmetin gizlilik koşulları geçerlidir.',
      'Parçalar ve kayıtlar önce oturum belleğinde tutulur. Oturum menüsünden açıkça kaydedersen kaynak dosyalar, cue noktaları, miks ayarları ve durdurulmuş kayıt bu cihazda rimvo-sessions adlı IndexedDB alanına yazılır (en fazla 256 MiB). Oturumu geri yüklemek müziği kendiliğinden başlatmaz. Kaydetmeden sayfayı kapatmak çalışmanı kaybettirebilir. Tarayıcı cihaz verilerini silebilir; önemli kayıtları ayrıca indir.',
      'Seçtiğin dil rimvo-language anahtarında yerel olarak hatırlanır. Ayrı kulaklık çıkışı isteğe bağlıdır; destekleyen tarayıcı ses çıkışı seçme izni isteyebilir. Mikrofon kullanılmaz. Kulaklık ön dinlemesi ana miks kaydına eklenmez.',
      'Tema tercihi yalnız Çerezler ve tercihler bölümündeki seçeneği açarsan cihazda hatırlanır. Kapatmak saklanan tercihi siler. Tarayıcının önbelleği, normal site dosyalarının yerel kopyalarını ayrıca tutabilir.',
    ] },
    { heading: 'İnternet ve barındırma', paragraphs: [
      'Uygulama dosyaları ve örnek parçalar uygulamanın kendi adresinden alınır. Örnek parçaları açmak, kişisel ses dosyalarını yüklemek anlamına gelmez.',
      'Yerel kullanımda bu sürümde merkezi bir ziyaretçi kaydı yoktur. RIMVO bir internet adresinde yayımlanırsa barındırma veya ağ sağlayıcısı IP adresi, erişim zamanı ve tarayıcı bilgisi gibi erişim kayıtları işleyebilir. Bu dağıtım için sağlayıcı, amaç, hukuki dayanak, saklama süresi, varsa aktarım ve iletişim bilgileri siteyi yayımlayan tarafından ayrıca açıklanmalıdır. Bu yerel sürüm bu bilgileri varsaymaz.',
    ] },
    { heading: 'Kontrol sende', paragraphs: [
      'Oturum menüsünden kaydedilmiş oturumu silebilir, parçaları kütüphaneden çıkarabilir, indirdiğin kayıtları cihazından silebilir ve tema saklamasını kapatabilirsin. Kaydedilmiş oturum, kütüphaneden parça çıkardığında değişmez; yeniden kaydet veya kayıtlı oturumu sil. Tarayıcının site verilerini temizlemek kayıtlı oturumu ve tercihleri kaldırır.',
      'Bir yayımlanmış site kişisel veri işliyorsa uygulanabilir mevzuat uyarınca bilgi edinme, erişim, düzeltme, silme ve ilgili diğer haklar için o sitenin veri sorumlusuna başvurulabilir. Yerel açık kaynak sürüm adına doğrulanmamış bir işletmeci veya iletişim adresi belirtilmemiştir.',
    ] },
  ],
  cookies: [
    { heading: 'Dil ve oturum kaydı', paragraphs: [
      'Dil seçimin localStorage alanındaki rimvo-language anahtarında saklanır. Oturum kaydı yalnız Oturum menüsündeki kaydet düğmesiyle oluşturulur ve IndexedDB içinde tutulur. Kaydı aynı menüden silebilirsin. Bu veriler cihazından bir sunucuya gönderilmez; site verilerini temizlemek hepsini kaldırır.',
    ] },
    { heading: 'Takip çerezi yok', paragraphs: [
      'Bu sürüm reklam, analiz veya üçüncü taraf takip çerezi oluşturmaz. RIMVO kodu document.cookie kullanmaz. Uygulamayı kullanmak için “tümünü kabul et” seçeneğine ihtiyacın yoktur.',
    ] },
    { heading: 'İsteğe bağlı tema tercihi', paragraphs: [
      'Aşağıdaki seçenek başlangıçta kapalıdır. Açarsan rimvo-theme anahtarında koyu/açık tema, rimvo-preferences anahtarında bu seçimin sürümü ve sona erme zamanı tarayıcının localStorage alanında saklanır. Bu kayıtlar ses dosyası, kimlik, reklam profili veya kullanım geçmişi içermez; bir sunucuya gönderilmez.',
      'Seçim 180 gün boyunca hatırlanır; süre dolunca sonraki açılışta silinir. Aşağıdaki seçeneği kapatarak daha erken silebilirsin. Kapalıyken tema bu oturumda değiştirilebilir, sonraki açılışta varsayılan koyu tema kullanılır. Tercihi reddetmek DJ kontrollerini veya kaydı sınırlamaz.',
    ] },
    { heading: 'Tarayıcı ve yayımlanan kopyalar', paragraphs: [
      'Tarayıcı, sitenin normal dosyalarını kendi önbelleğinde saklayabilir. Site verilerini tarayıcı ayarlarından temizleyebilirsin. İnternette yayımlanan bir kopyaya başka çerez, analiz veya hizmet eklenirse bu metin ve gerekli tercih mekanizması o dağıtım için güncellenmelidir.',
    ] },
  ],
  terms: [
    { heading: 'RIMVO ile üret', paragraphs: [
      'RIMVO iki parçayı yerel olarak çalmak, düzenlemek, efekt ve geçiş uygulamak ve mix kaydetmek için sunulur. Hesap açman veya kişisel dosyalarını yüklemen gerekmez. Çıkış kaydı yeni bir dosyadır; orijinal parçalar değişmez.',
    ] },
    { heading: 'Müzik ve haklar', paragraphs: [
      'Yalnız kullanmaya hakkın olan içerikleri seç. Bir parçayı satın almak ya da dinleme aboneliğine sahip olmak, onu yeniden yayımlama veya dağıtma hakkını otomatik olarak vermez. Mix üretmek, içerikteki telif ve bağlantılı hakları ortadan kaldırmaz.',
      'Kaydı paylaşmadan, yayımlamadan, ticari kullanmadan veya kamuya çalmadan önce gereken izin ve lisansları kontrol et. RIMVO bu izinleri senin adına edinmez; sesini, eserini veya kaydını kendisine devretmeni talep etmez.',
      'Uygulamayla gelen özgün örnek parçalar CC0-1.0 kapsamındadır. Yerel seslerine bu lisans uygulanmaz. Yazılımın MIT lisansı ve üçüncü taraf bileşenlerin kendi lisansları müzik lisansından ayrıdır.',
    ] },
    { heading: 'Kayıtlarını koru', paragraphs: [
      'Önemli bir kaydı sayfayı kapatmadan indir. Tarayıcı veya cihaz kısıtları, bellek yetersizliği, ekran kilidi, gelen arama ya da bağlantı kesintisi çalmayı veya kaydı durdurabilir. BPM ve ton tahminlerini gerektiğinde kulağınla ve kontrollerle düzelt. Kulaklık veya hoparlör sesini rahat bir seviyede tut.',
    ] },
    { heading: 'Açık kaynak ve yasal haklar', paragraphs: [
      'Yazılım açık kaynaklıdır; kaynak kodu kullanımı dağıtımla gelen MIT lisansına tabidir. Bu koşullar zorunlu tüketici haklarını, uygulanabilir kişisel veri koruma haklarını veya kanunun sınırlandırılmasına izin vermediği sorumlulukları kaldırmaz.',
      'İnternette yayımlanan veya ticari olarak sunulan bir sürümün işletmecisi ve ek koşulları o dağıtımda belirtilmelidir. Bu yerel sürüm için belirli bir şirket, mahkeme, ülke yetkisi veya iletişim adresi varsayılmaz. Davranış değiştiğinde bu metinlerin tarihi ve içeriği de güncellenmelidir.',
    ] },
  ],
};

export const englishPolicies: Record<LegalPage, readonly PolicySection[]> = {
  privacy: [
    { heading: 'Your music stays on your device', paragraphs: [
      'RIMVO reads selected audio files, metadata and artwork in your browser. Waveform, tempo and key analysis happen on your device. Personal music and recordings are not uploaded. RIMVO has no account, advertising or analytics service and does not request microphone, contacts or location access.',
    ] },
    { heading: 'Recordings and saved sessions', paragraphs: [
      'Recording starts only when you choose it and captures the master mix. Downloads and sharing create new copies; original tracks stay unchanged. When you approve sharing, the chosen service handles that copy under its own terms.',
      'Tracks and recordings initially live in memory. Save session explicitly stores source files, cues, effects, mixer controls and a stopped take in the rimvo-sessions IndexedDB database on this device, up to 256 MiB. Restoring never starts playback automatically. Closing the page without saving can lose work. Browser storage can be cleared, so download important recordings separately.',
      'Your chosen language is remembered locally under rimvo-language. Theme storage is optional. Separate headphone monitoring may request speaker-selection permission in a supporting browser, never microphone access. The monitor signal is not added to the master recording.',
    ] },
    { heading: 'Hosting and control', paragraphs: [
      'Application files and bundled demos come from this site. The hosting and network providers may process access information such as IP addresses and request times under their own policies.',
      'Delete saved sessions from the Session menu. Removing a library track does not change an existing save; save again or delete the saved session. Clear this site’s browser data to remove saved sessions and preferences. Downloaded files remain until you delete them from your device. A published deployment is responsible for describing any additional data processing and contact details.',
    ] },
  ],
  cookies: [
    { heading: 'No tracking cookies', paragraphs: ['RIMVO does not create advertising, analytics or third-party tracking cookies and does not use document.cookie. There is no accept-all requirement.'] },
    { heading: 'Language and sessions', paragraphs: ['Choosing a language stores rimvo-language in localStorage. Saving a session explicitly writes to IndexedDB. You can delete the saved session from its menu or clear all site data in browser settings. This data is not uploaded.'] },
    { heading: 'Optional theme preference', paragraphs: ['The option below starts off. Enabling it stores the dark/light theme under rimvo-theme and the preference version and expiry under rimvo-preferences in localStorage for 180 days. Disabling it deletes these entries. This preference contains no music, identity, advertising profile or usage history. Declining it does not limit the mixer or recording.'] },
    { heading: 'Browser cache', paragraphs: ['Your browser may cache ordinary application files. Clear site data in browser settings to remove them. Deployments that add services or tracking must update this information and any required controls.'] },
  ],
  terms: [
    { heading: 'Create with RIMVO', paragraphs: ['RIMVO lets you play and mix two tracks locally, apply effects and record a new output file. Original tracks stay unchanged. Use content you have permission to use and obtain the necessary rights before distributing or publicly playing your mix. RIMVO does not acquire music rights for you.'] },
    { heading: 'Licenses', paragraphs: ['Bundled original demos are CC0-1.0. That license does not apply to your own music. The software uses the MIT license; dependencies retain their own licenses, as listed in the distribution notices.'] },
    { heading: 'Protect your work', paragraphs: ['Download important recordings. Saved browser sessions are a convenience and may be cleared by the browser. Device limits, memory, screen locks or audio interruptions can stop playback or recording. Tempo and key estimates may need manual correction. Keep listening levels comfortable.'] },
    { heading: 'Open source', paragraphs: ['Source code use follows the included MIT license. These terms do not remove mandatory consumer or privacy rights or liabilities that cannot be limited by applicable law. A separately operated or commercial deployment must identify its operator and any additional terms.'] },
  ],
};

