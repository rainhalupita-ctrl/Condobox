'use client';

import React from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface QRGeneratorProps {
  value: string;
  size?: number;
  label?: string;
}

export function QRGenerator({ value, size = 180, label }: QRGeneratorProps) {
  return (
    <div className="flex flex-col items-center p-4 bg-white rounded-2xl shadow-xl">
      <QRCodeSVG
        value={value}
        size={size}
        level="H"
        includeMargin={false}
      />
      {label && (
        <span className="mt-2 text-xs font-mono font-bold text-slate-800 tracking-wider">
          {label}
        </span>
      )}
    </div>
  );
}
