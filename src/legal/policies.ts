export type LegalPage = 'privacy' | 'cookies' | 'terms';
export const legalTitles: Record<LegalPage, string> = {
  privacy: 'Gizlilik', cookies: 'Çerezler ve tercihler', terms: 'Kullanım koşulları',
};
export interface PolicySection { readonly heading: string; readonly paragraphs: readonly string[] }
export const policyVersion = '10 Ekim 2026';
export const policies: Record<LegalPage, readonly PolicySection[]> = {
  privacy: [
    { heading: 'Müzik cihazında kalır', paragraphs: [
      'RIMVO, açık kaynaklı bir tarayıcı DJ uygulamasıdır. Bu metin yerel sürümün davranışını açıklar. Hesap, reklam, analiz hizmeti veya medya yükleme sunucusu içermez.',
      'Seçtiğin ses dosyaları, dosya adı, boyutu, parça bilgisi ve kapak görseli tarayıcıda okunur. Dalga biçimi, BPM ve ton analizi cihazında yapılır; uygulama bu içeriği bir sunucuya göndermez. Mikrofon, kişiler veya konum izni istemez.',
    ] },
    { heading: 'Kayıt ve saklama', paragraphs: [
      'Mix kaydı yalnız sen başlattığında, uygulamanın ses çıkışından oluşturulur. Kayıt ve yeni sürümleri cihazına indirilebilir veya cihazının paylaşım menüsüne gönderilebilir. Kaynak ses dosyalarının üzerine yazılmaz. Paylaşımı onayladığında seçtiğin uygulama ya da hizmetin gizlilik koşulları geçerlidir.',
      'Yüklenen parçalar, analizleri ve henüz dışa aktarılmamış kayıtlar bu oturumun belleğinde tutulur. Sayfayı kapatmak veya yenilemek bu oturumu kaybettirebilir. İndirilen dosyalar, sen cihazından silene kadar cihazında kalır; RIMVO bu kopyaları uzaktan silemez.',
      'Tema tercihi yalnız Çerezler ve tercihler bölümündeki seçeneği açarsan cihazda hatırlanır. Kapatmak saklanan tercihi siler. Tarayıcının önbelleği, normal site dosyalarının yerel kopyalarını ayrıca tutabilir.',
    ] },
    { heading: 'İnternet ve barındırma', paragraphs: [
      'Uygulama dosyaları ve örnek parçalar uygulamanın kendi adresinden alınır. Örnek parçaları açmak, kişisel ses dosyalarını yüklemek anlamına gelmez.',
      'Yerel kullanımda bu sürümde merkezi bir ziyaretçi kaydı yoktur. RIMVO bir internet adresinde yayımlanırsa barındırma veya ağ sağlayıcısı IP adresi, erişim zamanı ve tarayıcı bilgisi gibi erişim kayıtları işleyebilir. Bu dağıtım için sağlayıcı, amaç, hukuki dayanak, saklama süresi, varsa aktarım ve iletişim bilgileri siteyi yayımlayan tarafından ayrıca açıklanmalıdır. Bu yerel sürüm bu bilgileri varsaymaz.',
    ] },
    { heading: 'Kontrol sende', paragraphs: [
      'Parçayı oturum kütüphanesinden çıkarabilir, kayıtlarını cihazından silebilir ve tema saklamasını kapatabilirsin. Tarayıcının site verilerini temizlemek de cihazda hatırlanan tercihi kaldırır.',
      'Bir yayımlanmış site kişisel veri işliyorsa uygulanabilir mevzuat uyarınca bilgi edinme, erişim, düzeltme, silme ve ilgili diğer haklar için o sitenin veri sorumlusuna başvurulabilir. Yerel açık kaynak sürüm adına doğrulanmamış bir işletmeci veya iletişim adresi belirtilmemiştir.',
    ] },
  ],
  cookies: [
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

