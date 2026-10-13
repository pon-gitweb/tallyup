import { ANDROID_URL, IOS_URL } from '../config/appLinks'
import styles from './GetTheApp.module.css'

export default function GetTheApp({ label, dark }: { label?: string; dark?: boolean }) {
  if (!ANDROID_URL && !IOS_URL) return null

  return (
    <div className={[styles.root, dark ? styles.dark : ''].filter(Boolean).join(' ')}>
      {label && <p className={styles.label}>{label}</p>}
      <div className={styles.links}>
        {ANDROID_URL && (
          <a
            href={ANDROID_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.link}
          >
            Get it on Google Play
          </a>
        )}
        {IOS_URL && (
          <a
            href={IOS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.link}
          >
            Download on the App Store
          </a>
        )}
      </div>
    </div>
  )
}
