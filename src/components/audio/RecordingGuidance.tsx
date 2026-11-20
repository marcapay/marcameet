import { Info } from "lucide-react";

export function RecordingGuidance() {
  return (
    <div className="flex items-start gap-2.5 rounded-2xl border border-slate-800 bg-slate-900/90 p-3 text-left text-xs leading-relaxed text-slate-300">
      <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
      <div className="space-y-2">
        <p className="font-semibold text-slate-100">Como manter a gravação ativa</p>
        <ul className="space-y-2">
          <li>
            <strong className="text-slate-100">No celular.</strong> Você pode abrir outra aba do Chrome ou consultar o WhatsApp, fotos, arquivos e e-mails mantendo a aba do gravador aberta. A captura continua enquanto o celular mantiver o microfone disponível. Ao voltar, confira se o gravador indica que está capturando. Bloquear a tela ou usar outro aplicativo que precise do microfone pode interromper a gravação.
          </li>
          <li>
            <strong className="text-slate-100">Se o telefone tocar.</strong> Ao atender, a ligação pode assumir o microfone. O Marca Reuniões não grava a ligação. Ao desligar, volte ao gravador e confira se a captura voltou. Se aparecer a opção de reconectar o áudio, use-a.
          </li>
          <li>
            <strong className="text-slate-100">No computador.</strong> A gravação pode continuar ao trocar de aba ou minimizar a janela, desde que o computador fique acordado e a aba do gravador continue aberta. Fechar a tampa ou colocar o computador em suspensão pode interromper a captura.
          </li>
          <li>
            <strong className="text-slate-100">Ao fechar ou recarregar a aba do gravador, a captura para.</strong> Finalize a gravação antes de sair. Os trechos já salvos ficam no aparelho, mas o áudio que deixou de ser capturado durante uma interrupção não pode ser recuperado.
          </li>
        </ul>
      </div>
    </div>
  );
}
