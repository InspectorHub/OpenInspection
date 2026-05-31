export interface PublishBlockingDefect {
    sectionId:    string;
    sectionTitle: string;
    itemId:       string;
    itemLabel:    string;
    cannedId:     string;
    cannedTitle:  string;
    missing:      Array<'location' | 'trade'>;
    unresolvedTokens: string[];
}

export interface PublishReadiness {
    ready: boolean;
    blockingDefects: PublishBlockingDefect[];
}

export interface ItemAttribute {
    id: string;
    name: string;
    type: 'boolean' | 'text' | 'number' | 'select' | 'multi_select' | 'date';
    choices?: string[];
    unit?: string;
    required?: boolean;
}
