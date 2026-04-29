import 'hono/jsx';
import type { JSX as HonoJSX } from 'hono/jsx';

declare global {
    namespace JSX {
        type Element = HonoJSX.Element | Promise<HonoJSX.Element>;
        interface IntrinsicElements extends HonoJSX.IntrinsicElements {
            /** HTML <template> element ??used by Alpine.js x-for */
            template: Record<string, unknown>;
        }
        interface HTMLAttributes extends HonoJSX.IntrinsicAttributes {
            'x-data'?: string;
            'x-show'?: string;
            'x-text'?: string;
            'x-html'?: string;
            'x-ref'?: string;
            'x-model'?: string;
            'x-if'?: string;
            'x-for'?: string;
            'x-transition'?: string | boolean;
            'x-transition:enter'?: string;
            'x-transition:enter-start'?: string;
            'x-transition:enter-end'?: string;
            'x-transition:leave'?: string;
            'x-transition:leave-start'?: string;
            'x-transition:leave-end'?: string;
            'x-collapse'?: boolean | string;
            'x-cloak'?: boolean;
            'x-bind:class'?: string;
            'x-bind:key'?: string;
            'x-bind:src'?: string;
            'x-bind:href'?: string;
            'x-bind:disabled'?: string;
            'x-bind:checked'?: string;
            'x-bind:value'?: string;
            'x-bind:style'?: string;
            'x-bind:x-ref'?: string;
            'x-on:click'?: string;
            'x-on:submit'?: string;
            'x-on:input'?: string;
            'x-on:input.debounce.500ms'?: string;
            'x-on:change'?: string;
            'x-on:scroll.window'?: string;
            'x-on:mousedown'?: string;
            'x-on:mousemove'?: string;
            'x-on:mouseup'?: string;
            'x-on:touchstart.passive'?: string;
            'x-on:touchmove.passive'?: string;
            'x-on:touchend.passive'?: string;
            '@click'?: string;
            '@click.outside'?: string;
            '@submit.prevent'?: string;
            '@input'?: string;
            '@change'?: string;
            'x-model.number'?: string;
            'x-bind:data-id'?: string;
            'x-bind:title'?: string;
            'x-bind:name'?: string;
        }
    }
}
