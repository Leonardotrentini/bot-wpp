import { useState } from 'react'
import {
  MessageSquare,
  RefreshCw,
  User,
  Clock,
  Zap,
  Kanban,
  Shield,
  AlertTriangle,
} from 'lucide-react'
import { Modal } from '../common/Modal.jsx'
import { Button } from '../common/Button.jsx'
import { markChatOnboardingSeen } from '../../lib/chatOnboarding.js'

function Section({ icon: Icon, title, children }) {
  return (
    <section className="rounded-xl border border-brand-700/80 bg-brand-950/40 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-accent-400" />
        <h3 className="text-sm font-semibold text-stone-100">{title}</h3>
      </div>
      <div className="space-y-2 text-sm leading-relaxed text-stone-400">{children}</div>
    </section>
  )
}

export function ChatOnboardingModal({ isOpen, user, onComplete }) {
  const [acknowledged, setAcknowledged] = useState(false)

  const handleContinue = () => {
    if (!acknowledged) return
    markChatOnboardingSeen(user)
    onComplete?.()
  }

  return (
    <Modal
      isOpen={isOpen}
      dismissible={false}
      size="lg"
      title="Bem-vindo às Conversas"
      footer={
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-stone-300">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-brand-600 bg-brand-900 text-accent-500 focus:ring-accent-500/40"
            />
            <span>Li e entendi. Não preciso ver este aviso novamente.</span>
          </label>
          <Button onClick={handleContinue} disabled={!acknowledged}>
            Começar a usar
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-stone-300">
          Esta aba funciona como um <strong className="font-medium text-stone-100">WhatsApp Web para chats individuais</strong>,
          integrada ao CRM do Vesto. Leia os pontos abaixo antes de sincronizar — isso evita lentidão e reduz risco de
          limitações do WhatsApp.
        </p>

        <Section icon={MessageSquare} title="O que você encontra aqui">
          <p>
            Conversas <strong className="text-stone-300">1:1</strong> (não inclui grupos). Novas mensagens entram em tempo
            real enquanto o WhatsApp estiver conectado. Use o painel à direita para tags, status, notas e ativar agente de
            IA por contato.
          </p>
        </Section>

        <Section icon={RefreshCw} title="Sincronizar conversas">
          <p>
            O botão <strong className="text-stone-300">Sincronizar</strong> importa mensagens antigas (7 a 180 dias), atualiza
            fotos de perfil, telefones e nomes do WhatsApp — tudo em um único processo,{' '}
            <strong className="text-stone-300">lento de propósito</strong> para não sobrecarregar a API.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Escolha o período no pop-up antes de iniciar.</li>
            <li>Pode levar de minutos a horas, conforme o volume.</li>
            <li>Se aparecer aviso de limite, aguarde: o job retoma sozinho depois.</li>
            <li>Não clique em sincronizar repetidas vezes seguidas.</li>
          </ul>
        </Section>

        <Section icon={User} title="Nomes e números">
          <p>
            Contatos não salvos no CRM aparecem com o <strong className="text-stone-300">telefone</strong> quando a API
            enviar. Salve um nome no painel à direita para identificar leads importantes.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Nome da agenda só aparece se o número estiver salvo no celular conectado.</li>
            <li>Contatos com número oculto (<code className="text-stone-300">@lid</code>) podem ficar sem telefone.</li>
          </ul>
        </Section>

        <Section icon={Clock} title="Por que demora?">
          <p>
            Cada perfil é consultado na Evolution API com <strong className="text-stone-300">intervalo de ~2,5 segundos</strong>{' '}
            entre contatos. É proteção anti-ban: atualizar centenas de perfis de uma vez poderia desconectar ou limitar
            sua conta.
          </p>
          <p>
            Depois de iniciar a sincronização, a lista vai preenchendo aos poucos. Mantenha a aba aberta ou recarregue
            depois de alguns minutos se ainda faltar algum contato.
          </p>
        </Section>

        <Section icon={Zap} title="Atalhos e produtividade">
          <p>
            Já deixamos <strong className="text-stone-300">funil de atacado</strong>,{' '}
            <strong className="text-stone-300">FUP automático</strong> e{' '}
            <strong className="text-stone-300">atalhos prontos</strong> na sua conta. Digite{' '}
            <strong className="text-stone-300">/</strong> no campo de mensagem (ex.: <code className="text-stone-300">/pix</code>,{' '}
            <code className="text-stone-300">/catalogo</code>) para responder mais rápido.
          </p>
          <p>
            Tags, estágios e atalhos extras ficam em <strong className="text-stone-300">CRM → Configurações</strong>.
          </p>
        </Section>

        <Section icon={Kanban} title="CRM e Kanban">
          <p>
            Cada conversa vira um card no <strong className="text-stone-300">CRM → Kanban</strong>. Arraste entre estágios
            (Novo, Qualificando, Orçamento enviado, etc.) para organizar seu funil de atacado.
          </p>
        </Section>

        <Section icon={Shield} title="Boas práticas">
          <ul className="list-disc space-y-1 pl-5">
            <li>Conecte o WhatsApp em <strong className="text-stone-300">Conectar WhatsApp</strong> antes de sincronizar.</li>
            <li>Evite enviar muitas mensagens automáticas seguidas pelo CRM no mesmo minuto.</li>
            <li>Resolva ou arquive conversas finalizadas para manter a inbox organizada.</li>
            <li>Use o filtro por tag e status para encontrar leads rapidamente.</li>
          </ul>
        </Section>

        <div className="flex gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/90">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p>
            Esta funcionalidade está em <strong>Beta</strong>. Se algo não aparecer como esperado, tente &quot;Nomes e
            fotos&quot; ou uma nova sincronização com período menor (ex.: 7 dias) antes de repetir com 180 dias.
          </p>
        </div>
      </div>
    </Modal>
  )
}
