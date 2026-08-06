// ============================================================================
// الصق هون كود الكونسول اللي شغّلته على أوبر.
// (امسح أي كوكيز/توكن حقيقي — مش محتاجينهم)
// ============================================================================


(async function ramenClientFixed() {
  // 1. معرف الجلسة
  const sessionUUID = crypto.randomUUID();

  // 2. تحديد الرابط الصحيح (نستخدم ramendca كما في طلباتك)
  const baseUrl = 'https://vsdispatch.uber.com/ramendca/events';
  console.log(`📍 باستخدام الرابط: ${baseUrl}`);

  // 3. رؤوس الطلبات (مطابقة لما في Network)
  const headers = {
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    'x-uber-client-name': 'vs_dispatch',
    'x-uber-client-session': sessionUUID,
    'x-uber-client-version': '1.0.0',
    'x-uber-device': 'web',
    'x-uber-device-id': `vs_dispatch-${crypto.randomUUID()}`,
  };

  // 4. المصافحة (ACK) - seq=-1
  const ackUrl = `${baseUrl}/ack?seq=-1`;
  console.log('📡 جاري المصافحة...');
  try {
    const ackRes = await fetch(ackUrl, {
      method: 'GET',
      headers: headers,
      credentials: 'include',
      mode: 'cors'
    });
    console.log(`✅ المصافحة: الحالة ${ackRes.status}`);
    if (!ackRes.ok) {
      console.error('❌ فشلت المصافحة');
      return;
    }
  } catch (e) {
    console.error('❌ خطأ في المصافحة:', e);
    return;
  }

  // 5. فتح التيار (RECV) - seq=0
  const recvUrl = `${baseUrl}/recv?seq=0`;
  console.log('📡 جاري فتح التيار...');

  try {
    const response = await fetch(recvUrl, {
      method: 'GET',
      headers: headers,
      credentials: 'include',
      mode: 'cors'
    });

    if (!response.ok) {
      console.error(`❌ فشل فتح التيار: ${response.status}`);
      return;
    }

    console.log('✅ التيار مفتوح! في انتظار الأحداث...');

    // قراءة التيار كـ SSE
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log('🔌 التيار مغلق من السيرفر، سيتم إعادة المحاولة بعد 5 ثوانٍ...');
        setTimeout(ramenClientFixed, 5000);
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          if (data) {
            try {
              const event = JSON.parse(data);
              console.log('📨 حدث:', event);
            } catch (e) {
              console.log('📨 بيانات خام:', data);
            }
          }
        } else if (line.startsWith('event:')) {
          console.log('🏷️ نوع الحدث:', line.slice(6).trim());
        }
      }
    }
  } catch (err) {
    console.error('❌ خطأ في التيار:', err);
    // إعادة المحاولة بعد 5 ثوانٍ
    setTimeout(ramenClientFixed, 5000);
  }
})();