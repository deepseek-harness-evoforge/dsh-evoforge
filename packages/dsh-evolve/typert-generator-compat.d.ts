/**
 * Build-only declaration face for out-of-tree Typert generation.
 *
 * The pinned generator recognizes Remote symbols by their owning module name,
 * while TypeScript otherwise resolves the installed protocol declaration as an
 * unregistered external package. Runtime JavaScript and published declarations
 * continue to use the real `@deepseek-ai/dsh-typert-protocol` package.
 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertLookup<Host, Wire> {
    readonly __host?: Host
    readonly __wire?: Wire
  }

  interface TypertContext<Wire> {
    readonly __wire?: Wire
  }

  interface TypertLookupMap {}
  interface TypertContextMap {}
  interface TypertRemoteMap {}
  interface TypertRemoteScopeMap {}
  interface TypertRemoteNamespaceMap {}

  interface TypertGatewayBinding<Service extends object = object> {
    readonly service: Service
    readonly serviceKey: string
    readonly namespace: string
  }

  interface TypertGatewayBindingOptions {
    readonly namespace?: string
  }

  abstract class TypertRemoteService<out T = never> {
    readonly typertRemote: TypertGatewayBinding<this>
    protected constructor(
      ctx: import('@deepseek-ai/cordis').Context,
      serviceKey: string,
      options?: TypertGatewayBindingOptions,
    )
  }

  type RemoteMethodDecorator = <This extends object, Args extends unknown[], Result>(
    method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ) => void

  function Remote<This extends object, Args extends unknown[], Result>(
    method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ): void
  function Remote(exportName: string): RemoteMethodDecorator
}
