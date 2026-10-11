import { CaptureFlow } from '../capture/CaptureFlow';

/**
 * Academic inbox: PASTE a message (a professor's reminder, an instruction) -> the app interprets it -> REVIEW what is in
 * doubt -> CONFIRM once. It is the same flow and the same review as Quick Capture; a pasted message is read more
 * conservatively (a sentence that is not about an activity yields nothing) and the box is bigger.
 */
export function InboxPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Bandeja académica</h1>
      <CaptureFlow
        mode="INBOX"
        label="Mensaje del profesor o instrucción académica"
        placeholder="Pega aquí un mensaje de tu profesor o una instrucción académica…"
        rows={8}
        help="Se interpreta aquí mismo, sin enviar el texto a ningún servicio externo y sin guardarlo. Nada se crea hasta que confirmes."
        submitLabel="Interpretar mensaje"
        level={2}
      />
    </div>
  );
}
