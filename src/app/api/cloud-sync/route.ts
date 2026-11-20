import { NextResponse } from "next/server";

function retired() {
  return NextResponse.json({ error: "A sincronização antiga foi desativada. Use o acesso verificado." },
    { status: 410, headers: { "Cache-Control": "no-store" } });
}

export { retired as GET, retired as POST };
