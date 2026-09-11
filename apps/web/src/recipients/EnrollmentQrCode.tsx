import { QRCodeSVG } from 'qrcode.react'
import { type EnrollmentPayload, encodeEnrollmentPayload } from './enrollment-workspace'
import './EnrollmentQrCode.css'

type EnrollmentQrCodeProps = {
  payload: EnrollmentPayload
  recipientName: string
}

/**
 * The enrollment secret is only ever drawn, never written out: rendering it as
 * text would put it in the page and read it aloud to a screen reader.
 */
export function EnrollmentQrCode({ payload, recipientName }: EnrollmentQrCodeProps) {
  return (
    <div className="enrollment-qr">
      <QRCodeSVG
        value={encodeEnrollmentPayload(payload)}
        size={240}
        level="M"
        title={`Enrollment code for ${recipientName}`}
        role="img"
      />
      <p className="visually-hidden">
        Point {recipientName}'s device camera at this code to start the enrollment.
      </p>
    </div>
  )
}
