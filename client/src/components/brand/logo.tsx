import Image from "next/image";
import Link from "next/link";

export function Logo({
  footer = false,
  mobileMark = false,
}: {
  footer?: boolean;
  mobileMark?: boolean;
}) {
  return (
    <Link
      href="/"
      aria-label="Termbook home"
      className={`touch-target inline-flex shrink-0 items-center text-inherit no-underline ${mobileMark ? "brand-logo--mobile-mark" : ""}`}
    >
      <Image
        src="/brand/logo.svg"
        alt="Termbook"
        width={603}
        height={96}
        priority={!footer}
        className={
          footer
            ? "block h-auto w-[132px]"
            : "brand-wordmark block h-auto w-[164px] max-[740px]:w-36 max-[430px]:w-32"
        }
      />
      {mobileMark && (
        <Image
          src="/brand/mark.svg"
          alt=""
          width={360}
          height={360}
          className="brand-mobile-mark"
        />
      )}
    </Link>
  );
}
