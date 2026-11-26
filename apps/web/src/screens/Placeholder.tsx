type Props = {
  title: string;
  ticket: number;
  copy: string;
};

export function Placeholder({ title, ticket, copy }: Props) {
  return (
    <section className="screen">
      <header className="screen-head">
        <p className="eyebrow">Coming with ticket #{ticket}</p>
        <h1>{title}</h1>
        <p className="lede">{copy}</p>
      </header>
    </section>
  );
}
