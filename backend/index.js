/**
 * Google Cloud Function (Gen 2 - Node.js 20)
 * Função HTTP: capturarLead
 *
 * Variáveis de ambiente necessárias no deploy:
 * - TELEGRAM_BOT_TOKEN: Token do bot gerado no @BotFather (ex.: "123456789:ABCdefGHIjklMNOpqrSTUvwxYZ")
 * - TELEGRAM_CHAT_ID: ID do chat ou grupo que receberá os alertas (ex.: "-1001234567890" ou "123456789")
 * - ALLOWED_ORIGIN (Opcional): Domínio permitido no CORS (padrão: "*")
 *
 * Exemplo de comando de deploy (gcloud CLI):
 * gcloud functions deploy capturarLead \
 *   --gen2 \
 *   --runtime=nodejs20 \
 *   --region=southamerica-east1 \
 *   --source=./backend \
 *   --entry-point=capturarLead \
 *   --trigger-http \
 *   --allow-unauthenticated \
 *   --set-env-vars TELEGRAM_BOT_TOKEN="SEU_TOKEN_AQUI",TELEGRAM_CHAT_ID="SEU_CHAT_ID_AQUI"
 */

const functions = require('@google-cloud/functions-framework');
const { Firestore, FieldValue } = require('@google-cloud/firestore');

// Inicializa o cliente do Google Cloud Firestore
// (Autenticação automática via Application Default Credentials no GCP)
const firestore = new Firestore();

functions.http('capturarLead', async (req, res) => {
  // =========================================================================
  // 1. CONFIGURAÇÃO DE CORS (POST e OPTIONS)
  // Substitua '*' pela URL oficial da sua Landing Page em produção se desejar restringir
  // =========================================================================
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.set('Access-Control-Allow-Origin', allowedOrigin);
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.set('Access-Control-Max-Age', '3600');

  // Resposta imediata para preflight request (OPTIONS)
  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  // Aceita apenas método POST
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Método não permitido. Utilize POST.'
    });
  }

  try {
    const body = req.body || {};
    const nome = typeof body.nome === 'string' ? body.nome.trim() : '';
    const whatsapp = typeof body.whatsapp === 'string' ? body.whatsapp.trim() : '';
    const servicos = Array.isArray(body.servicos) ? body.servicos : [];
    const servico =
      typeof body.servico === 'string' && body.servico.trim()
        ? body.servico.trim()
        : servicos.join(', ') || 'Não especificado';
    const mensagem = typeof body.mensagem === 'string' ? body.mensagem.trim() : '';
    const origem = typeof body.origem === 'string' ? body.origem.trim() : '';

    // =========================================================================
    // 2. VALIDAÇÃO DOS CAMPOS OBRIGATÓRIOS (nome e whatsapp)
    // =========================================================================
    if (!nome || !whatsapp) {
      return res.status(400).json({
        success: false,
        error: 'Os campos "nome" e "whatsapp" são obrigatórios.'
      });
    }

    // =========================================================================
    // 3. GRAVAÇÃO NA COLEÇÃO "leads" DO GOOGLE CLOUD FIRESTORE
    // =========================================================================
    const leadData = {
      nome,
      whatsapp,
      servicos,
      servico,
      mensagem,
      origem,
      userAgent: req.get('user-agent') || '',
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '',
      createdAt: FieldValue.serverTimestamp()
    };

    const docRef = await firestore.collection('leads').add(leadData);

    // =========================================================================
    // 4. NOTIFICAÇÃO INSTANTÂNEA PARA BOT DO TELEGRAM (VIA FETCH NATIVO NODE 20)
    // Configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID nas variáveis de ambiente da Cloud Function
    // =========================================================================
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;

    if (telegramToken && telegramChatId) {
      const textoTelegram = [
        `🚀 *Novo Lead Capturado — SE7E.ENT*`,
        ``,
        `👤 *Nome/Empresa:* ${escapeMarkdown(nome)}`,
        `📱 *WhatsApp:* ${escapeMarkdown(whatsapp)}`,
        `🎯 *Serviço(s):* ${escapeMarkdown(servico)}`,
        mensagem ? `💬 *Mensagem:* ${escapeMarkdown(mensagem)}` : null,
        `🆔 *Firestore ID:* \`${docRef.id}\``
      ]
        .filter(Boolean)
        .join('\n');

      const telegramUrl = `https://api.telegram.org/bot${telegramToken}/sendMessage`;

      try {
        const tgResponse = await fetch(telegramUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegramChatId,
            text: textoTelegram,
            parse_mode: 'Markdown'
          })
        });

        if (!tgResponse.ok) {
          const tgErr = await tgResponse.text();
          console.error('[Telegram Alert] Falha ao enviar mensagem:', tgErr);
        }
      } catch (tgError) {
        // Não interrompe o retorno 200 caso a API do Telegram oscile
        console.error('[Telegram Alert] Erro de rede ao notificar Telegram:', tgError.message);
      }
    } else {
      console.warn(
        '[Telegram Alert] Variáveis TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID não configuradas.'
      );
    }

    // =========================================================================
    // 5. RETORNO DE SUCESSO (STATUS 200)
    // =========================================================================
    return res.status(200).json({
      success: true,
      id: docRef.id
    });
  } catch (error) {
    console.error('[capturarLead] Erro interno ao processar lead:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno ao registrar lead.'
    });
  }
});

/**
 * Escapa caracteres especiais básicos do Markdown v1 do Telegram
 */
function escapeMarkdown(text = '') {
  return String(text).replace(/([_*`\[])/g, '\\$1');
}
