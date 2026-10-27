// Adresse du code source, montrée aux joueurs : la licence AGPL (article 13) demande que les
// utilisateurs d'une version en ligne puissent obtenir son code. Une version modifiée publiée
// doit pointer vers son propre code : VITE_SOURCE_URL au moment du build.
export const SOURCE_URL: string = import.meta.env.VITE_SOURCE_URL || '';
