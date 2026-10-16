import { createContext, useContext } from 'react'

export const AuthContext = createContext(null)
export const FacilityContext = createContext(null)
export const ToastContext = createContext(null)

/** { user, loading, isOwner, signIn, signUp, signOut, sendReset, updatePassword } */
export const useAuth = () => useContext(AuthContext)
/** { settings, courts, loading, error, reload } */
export const useFacility = () => useContext(FacilityContext)
/** toast(message, tone?) */
export const useToast = () => useContext(ToastContext)
