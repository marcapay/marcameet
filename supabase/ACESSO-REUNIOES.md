# Acesso às reuniões

A reunião parte de **Particular**. O dono confirma o e-mail via Supabase Auth e salva uma cópia protegida no painel **Gerenciar acesso**. A cópia é pesquisável por quem tem permissão. O dono pode alterar os destinatários ou voltar para Particular. O link identifica a reunião e exige uma conta autorizada. Anexos locais ficam no aparelho.

## Ativação

1. Confira os backups e o vínculo de propriedade das reuniões legadas. A migração `migrations/03_meeting_access.sql` revoga o acesso direto aos dados legados e os deixa preservados no banco. Ela não associa reuniões antigas a novos usuários. Mantenha cópias locais ou reimporte os dados dos proprietários por um processo administrativo verificável.
2. Configure o projeto do Supabase em `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` no ambiente do app. Ative a verificação de e-mail do Supabase Auth e permita os redirecionamentos para o domínio do aplicativo e as páginas de reuniões. Verifique o envio de links de acesso.
3. Aplique a migração no ambiente de teste e valide com contas de dono, convidado e usuário sem acesso. Aplique em produção em uma janela coordenada com a publicação da versão que encerra a antiga rota de sincronização. Restrinja implantações antigas que ainda possam servir a rota legada.
4. Para habilitar **Toda a equipe**, um administrador do banco insere a equipe em `public.access_teams` e vincula os UUIDs verificados do Supabase Auth em `public.access_team_members`. Cada conta pertence a uma equipe nesta versão. Não exponha a edição dessas tabelas aos usuários.
5. Para **Pessoas selecionadas**, os destinatários confirmam seus e-mails primeiro. O dono salva as permissões e pode enviar o link protegido pelo canal que usa com a equipe.
