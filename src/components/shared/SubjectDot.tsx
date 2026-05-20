interface Props {
  color: string;
  size?: number;
}

export default function SubjectDot({ color, size = 10 }: Props) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
      }}
    />
  );
}
